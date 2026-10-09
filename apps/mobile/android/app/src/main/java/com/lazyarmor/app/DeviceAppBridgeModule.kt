package com.lazyarmor.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.PermissionAwareActivity
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Device-level bridge for user-initiated Generic App Connection flows.
 * Discovery asks Android for launchable applications only. It does not use
 * QUERY_ALL_PACKAGES, does not infer providers, and does not persist an app inventory.
 */
class DeviceAppBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  /** Canonical server-approved task only; no raw calendar-write entry point. */
  @ReactMethod
  fun executeClaimedRuntimeTask(account:String,taskText:String,promise:Promise) {
    Thread {
      try {
        require(android.os.Build.VERSION.SDK_INT >= 26 && taskText.length <= 60000)
        val task=org.json.JSONObject(taskText)
        require(task.getString("taskType") in listOf("NATIVE_CALENDAR_CREATE","NATIVE_CALENDAR_WRITE") && task.getString("status") in listOf("CLAIMED","RUNNING"))
        val ticket=task.getJSONObject("dispatchAuthorization")
        require(BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY.isNotEmpty()) { "DISPATCH_KEY_UNCONFIGURED" }
        val payload=Base64.decode(ticket.getString("payload"),Base64.NO_WRAP)
        val signature=Base64.decode(ticket.getString("signature"),Base64.NO_WRAP)
        val key=java.security.KeyFactory.getInstance("EC").generatePublic(java.security.spec.X509EncodedKeySpec(Base64.decode(BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY,Base64.NO_WRAP)))
        val verifier=Signature.getInstance("SHA256withECDSA");verifier.initVerify(key);verifier.update(payload)
        require(verifier.verify(signature)) { "INVALID_DISPATCH_SIGNATURE" }
        val claims=org.json.JSONObject(String(payload,Charsets.UTF_8))
        require(claims.getString("version")=="1" && claims.getString("userId")==account
          && claims.getString("taskId")==task.getString("id") && claims.getString("claimToken")==task.getString("claimToken")) { "DISPATCH_BINDING_MISMATCH" }
        require(java.time.OffsetDateTime.parse(claims.getString("expiresAt")).toInstant().toEpochMilli()>System.currentTimeMillis()) { "DISPATCH_LEASE_EXPIRED" }
        val invocation=org.json.JSONObject(claims.getString("invocationJson"))
        require(invocation.getString("verificationContractRef")==claims.getString("verificationContractHash"))
        val result=CalendarInvocationExecutor.execute(reactApplicationContext,account,invocation,claims.getString("targetId"),claims.getLong("authorityEpoch"),invocation.getString("invocationId"),claims.optBoolean("lookupOnly",false))
        promise.resolve(result.toString())
      } catch(error:Exception) {promise.reject("DEVICE_WRITE_EXECUTION_FAILED",error)}
    }.start()
  }
  private val maxDiscoveryResults = 200
  private val iconSizePx = 48
  private val maxIconBytes = 24_000
  private val trustedDeviceKeyAlias = "lazy_armor_trusted_device_key_v1"
  private val speechPermissionRequestCode = 7104
  private var speechPromise: Promise? = null
  private var speechRecognizer: SpeechRecognizer? = null

  @ReactMethod
  fun readClipboardOnDemand(promise:Promise){
    val activity=reactApplicationContext.currentActivity
    if(activity==null||!activity.hasWindowFocus()){promise.reject("FOREGROUND_REQUIRED","请在前台主动粘贴");return}
    if(!LocalCapabilityManifest.activeGrant(reactApplicationContext,"clipboard.read_on_demand")){promise.reject("USER_GRANT_REQUIRED","请先开启剪贴板按需读取授权");return}
    val clipboard=reactApplicationContext.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    val text=clipboard.primaryClip?.getItemAt(0)?.coerceToText(reactApplicationContext)?.toString().orEmpty()
    if(text.length>12000){promise.reject("PAYLOAD_TOO_LARGE","分享内容过长");return};promise.resolve(text)
  }
  @ReactMethod
  fun pendingShareArtifact(account:String,receiptId:String,promise:Promise){
    val receipt=ArtifactShareReceipt.get(reactApplicationContext,account,receiptId)
    if(receipt==null){promise.resolve(null);return}
    val bytes=receipt.bytes
    promise.resolve(org.json.JSONObject().put("contentBase64",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("receivedAt",receipt.receivedAt).put("rawText",receipt.text).put("mimeType",receipt.mimeType).put("fileName",receipt.fileName).put("children",org.json.JSONArray(receipt.children)).toString())
  }
  @ReactMethod
  fun artifactShareReceipt(account:String,receiptId:String,artifactId:String,expectedHash:String,promise:Promise){
    try{
      val receipt=ArtifactShareReceipt.get(reactApplicationContext,account,receiptId)?:throw IllegalArgumentException()
      val hash=MessageDigest.getInstance("SHA-256").digest(receipt.bytes).joinToString(""){"%02x".format(it)}
      require(hash==expectedHash)
      val now=receipt.receivedAt
      val item=org.json.JSONObject().put("artifactId",artifactId).put("sourceSha256",hash).put("acquisitionMethod","ANDROID_SHARE_INTENT").put("userConfirmed",true).put("operationPermission","GRANTED").put("readSucceeded",true).put("receivedAt",now)
      val items=org.json.JSONArray().put(item);val content=items.toString()
      val contentHash=MessageDigest.getInstance("SHA-256").digest(content.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
      promise.resolve(org.json.JSONObject().put("manifestVersion","android-artifact-v1").put("capability","share.read").put("state","VERIFIED_PRESENT").put("observedAt",now).put("scopeStart",now-1000).put("scopeEnd",now+1000).put("itemCount",1).put("items",items).put("contentJson",content).put("contentHash",contentHash).toString())
    }catch(_:Exception){promise.reject("E_SHARE_EVIDENCE","分享来源证据已失效，请重新分享")}
  }
  @ReactMethod
  fun artifactFileReceipt(account:String,uriText:String,artifactId:String,expectedHash:String,promise:Promise){
    if(LocalCapabilityManifest.activeAccount(reactApplicationContext)!=account||!LocalCapabilityManifest.granted(reactApplicationContext,account,"files.read")){promise.resolve(null);return}
    Thread {
      try{
        require(expectedHash.matches(Regex("[a-f0-9]{64}")))
        val uri=android.net.Uri.parse(uriText)
        require(uri.scheme=="content"||uri.scheme=="file")
        if(uri.scheme=="file"){
          val file=java.io.File(uri.path?:throw IllegalArgumentException()).canonicalFile
          val cache=reactApplicationContext.cacheDir.canonicalFile
          require(file.path.startsWith(cache.path+java.io.File.separator))
        }
        val bytes=reactApplicationContext.contentResolver.openInputStream(uri)?.use {stream->
          val output=ByteArrayOutputStream();val buffer=ByteArray(8192)
          while(true){val count=stream.read(buffer);if(count<0)break;require(output.size()+count<=2_000_000);output.write(buffer,0,count)}
          output.toByteArray()
        }?:throw IllegalArgumentException()
        require(bytes.isNotEmpty()&&bytes.size<=2_000_000)
        val actual=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
        require(actual==expectedHash)
        val now=System.currentTimeMillis()
        val item=org.json.JSONObject().put("artifactId",artifactId).put("sourceSha256",actual).put("acquisitionMethod","ANDROID_DOCUMENT_PICKER").put("userConfirmed",true).put("operationPermission","GRANTED").put("readSucceeded",true).put("receivedAt",now)
        val items=org.json.JSONArray().put(item);val content=items.toString()
        val contentHash=MessageDigest.getInstance("SHA-256").digest(content.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
        promise.resolve(org.json.JSONObject().put("manifestVersion","android-artifact-v1").put("capability","files.read").put("state","VERIFIED_PRESENT").put("observedAt",now).put("scopeStart",now-1000).put("scopeEnd",now+1000).put("itemCount",1).put("items",items).put("contentJson",content).put("contentHash",contentHash).toString())
      }catch(_:Exception){promise.reject("E_ARTIFACT_EVIDENCE","文件读取证据未完成，请重新选择文件")}
    }.start()
  }
  @ReactMethod
  fun clearLocalCapabilityAccount(promise:Promise){ArtifactShareReceipt.clear();LocalCapabilityManifest.activateAccount(reactApplicationContext,null);promise.resolve(true)}
  @ReactMethod
  fun localCapabilities(account:String,promise:Promise){try{LocalCapabilityManifest.activateAccount(reactApplicationContext,account);promise.resolve(LocalCapabilityManifest.snapshot(reactApplicationContext,account).toString())}catch(error:Exception){promise.reject("E_MANIFEST",error)}}
  @ReactMethod
  fun setLocalCapabilityGrant(account:String,key:String,enabled:Boolean,promise:Promise){try{LocalCapabilityManifest.setGrant(reactApplicationContext,account,key,enabled);promise.resolve(true)}catch(error:Exception){promise.reject("E_GRANT",error)}}
  @ReactMethod
  fun acquireLocalResource(account:String,capability:String,start:Double,end:Double,promise:Promise) {
    if(!LocalCapabilityManifest.granted(reactApplicationContext,account,capability)){promise.reject("E_USER_GRANT","请先开启此本机能力");return}
    Thread { try { promise.resolve(LocalAcquisition.read(reactApplicationContext,capability,start.toLong(),end.toLong()).toString()) }
    catch (_:Exception) {promise.reject("E_ACQUISITION","本轮本机读取未完成")} }.start()
  }

  @ReactMethod
  fun runtimeSettings(promise: Promise) {
    val prefs = reactApplicationContext.getSharedPreferences("lazy_armor_runtime_settings", android.content.Context.MODE_PRIVATE)
    val result = Arguments.createMap()
    result.putBoolean("acquisition", prefs.getBoolean("acquisition", true) && LazyArmorNotificationListener.status(reactApplicationContext).optBoolean("accessGranted"))
    result.putBoolean("notifications", prefs.getBoolean("notifications", true) && androidx.core.app.NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled())
    result.putBoolean("background", prefs.getBoolean("background", true))
    result.putString("deviceName", Build.MANUFACTURER + " " + Build.MODEL)
    promise.resolve(result)
  }

  @ReactMethod
  fun setRuntimeSetting(key: String, enabled: Boolean, promise: Promise) {
    if (key !in listOf("acquisition", "notifications", "background")) { promise.reject("E_SETTING", "Unknown setting"); return }
    reactApplicationContext.getSharedPreferences("lazy_armor_runtime_settings", android.content.Context.MODE_PRIVATE).edit().putBoolean(key, enabled).commit()
    if (!enabled && key == "acquisition") {
      reactApplicationContext.getSharedPreferences("lazy_armor_notification_source", android.content.Context.MODE_PRIVATE).edit().putString("notification_preview_queue", "[]").commit()
    }
    if (!enabled && key == "background") {
      AppReadSessionStore.stop(reactApplicationContext)
      reactApplicationContext.stopService(Intent(reactApplicationContext, AppReadForegroundService::class.java))
    }
    if (!enabled && key == "notifications") androidx.core.app.NotificationManagerCompat.from(reactApplicationContext).cancelAll()
    promise.resolve(true)
  }

  @ReactMethod
  fun openAppNotificationSettings(promise: Promise) {
    try {
      reactApplicationContext.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("E_SETTINGS", error) }
  }

  override fun getName(): String = "LazyArmorDeviceBridge"

  @ReactMethod
  fun startSpeechRecognition(account:String, locale: String, promise: Promise) {
    if(!LocalCapabilityManifest.granted(reactApplicationContext,account,"voice.input")){promise.reject("E_USER_GRANT","请先在资源页开启语音输入");return}
    if (speechPromise != null) {
      promise.reject("E_SPEECH_BUSY", "已有语音输入正在进行。")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      promise.reject("E_SPEECH_ACTIVITY_UNAVAILABLE", "当前无法启动系统语音输入。")
      return
    }
    speechPromise = promise
    if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      beginSpeechRecognition(locale)
      return
    }
    activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), speechPermissionRequestCode) { requestCode, _, grantResults ->
      if (requestCode != speechPermissionRequestCode) return@requestPermissions false
      if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) beginSpeechRecognition(locale)
      else finishSpeechWithError("E_SPEECH_PERMISSION_DENIED", "需要麦克风权限才能使用语音输入。")
      true
    }
  }

  private fun beginSpeechRecognition(locale: String) {
    Handler(Looper.getMainLooper()).post {
      if(speechPromise==null)return@post
      if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
        finishSpeechWithError("E_SPEECH_UNAVAILABLE", "此设备没有可用的系统语音识别服务。")
        return@post
      }
      try {
        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext).also { recognizer ->
          recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() { reactApplicationContext.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("LazyArmorVoiceState","TRANSCRIBING") }
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
            override fun onError(error: Int) {
              val message = when (error) {
                SpeechRecognizer.ERROR_AUDIO -> "麦克风被占用或录音失败，请关闭其它录音后重试。"
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "系统语音识别网络连接失败，请检查网络后重试。"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "系统语音识别缺少麦克风权限，请在系统设置中允许。"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "系统语音识别正在被占用，请稍后重试。"
                SpeechRecognizer.ERROR_SERVER -> "系统语音识别服务暂不可用，请稍后重试。"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "没有检测到讲话，请点麦克风后开始说话。"
                SpeechRecognizer.ERROR_NO_MATCH -> "未能听清，请靠近麦克风后重试。"
                SpeechRecognizer.ERROR_CLIENT -> "语音输入已取消。"
                else -> "系统语音识别失败，请检查系统语音服务后重试。"
              }
              android.util.Log.w("LazyArmorVoice", "recognition_error=$error")
              finishSpeechWithError("E_SPEECH_$error", message)
            }
            override fun onResults(results: Bundle?) {
              val transcript = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull { it.isNotBlank() }?.trim()
              if (transcript.isNullOrBlank()) finishSpeechWithError("E_SPEECH_EMPTY", "没有识别到语音内容。") else finishSpeechWithResult(transcript.take(1000))
            }
          })
          recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale.take(20).ifBlank { "zh-CN" })
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
          })
        }
      } catch (error: Exception) {
        val pending = speechPromise
        speechPromise = null
        speechRecognizer?.destroy()
        speechRecognizer = null
        pending?.reject("E_SPEECH_START_FAILED", "无法启动系统语音输入。", error)
      }
    }
  }

  @ReactMethod
  fun cancelSpeechRecognition(promise: Promise) {
    Handler(Looper.getMainLooper()).post {
      speechRecognizer?.cancel()
      finishSpeechWithError("E_SPEECH_CANCELLED", "语音输入已取消。")
      promise.resolve(true)
    }
  }

  private fun finishSpeechWithResult(transcript: String) {
    val pending = speechPromise
    speechPromise = null
    speechRecognizer?.destroy()
    speechRecognizer = null
    pending?.resolve(transcript)
  }

  private fun finishSpeechWithError(code: String, message: String) {
    val pending = speechPromise
    speechPromise = null
    speechRecognizer?.destroy()
    speechRecognizer = null
    pending?.reject(code, message)
  }

  @ReactMethod
  fun getTrustedDeviceIdentity(promise: Promise) {
    try {
      val keyPair = trustedDeviceKeyPair()
      val publicKeySpki = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP)
      val publicKeyFingerprint = sha256Bytes(keyPair.public.encoded)
      val result = Arguments.createMap()
      result.putString("keyId", "android-keystore-${publicKeyFingerprint.take(24)}")
      result.putString("publicKeySpki", publicKeySpki)
      result.putString("publicKeyFingerprint", publicKeyFingerprint)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_TRUSTED_DEVICE_KEY_FAILED", "无法准备此设备的安全密钥。", error)
    }
  }

  @ReactMethod
  fun signTrustedDeviceChallenge(payload: String, promise: Promise) {
    if (!payload.startsWith("lazy-armor-device-proof-v1|") || payload.length > 512) {
      promise.reject("E_TRUSTED_DEVICE_CHALLENGE_INVALID", "设备证明请求无效。")
      return
    }
    try {
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(trustedDeviceKeyPair().private)
      signature.update(payload.toByteArray(Charsets.UTF_8))
      promise.resolve(Base64.encodeToString(signature.sign(), Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("E_TRUSTED_DEVICE_SIGN_FAILED", "无法完成设备密钥证明。", error)
    }
  }

  @ReactMethod
  fun signTrustedDeviceRequest(payload: String, promise: Promise) {
    if (!payload.startsWith("lazy-armor-device-request-v1|") || payload.length > 1024) {
      promise.reject("E_TRUSTED_DEVICE_REQUEST_INVALID", "设备请求签名内容无效。")
      return
    }
    try {
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(trustedDeviceKeyPair().private)
      signature.update(payload.toByteArray(Charsets.UTF_8))
      promise.resolve(Base64.encodeToString(signature.sign(), Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("E_TRUSTED_DEVICE_REQUEST_SIGN_FAILED", "无法完成设备请求签名。", error)
    }
  }

  @ReactMethod
  fun createTrustedDeviceRequestEnvelope(sessionId: String, method: String, requestPath: String, payloadJson: String, promise: Promise) {
    if (sessionId.isBlank() || sessionId.length > 128 || method !in setOf("GET", "POST") || !requestPath.startsWith("/") || requestPath.length > 255 || payloadJson.length > 65_536 || (method == "GET" && payloadJson != "{}")) {
      promise.reject("E_TRUSTED_DEVICE_REQUEST_ENVELOPE_INVALID", "设备请求内容无效。")
      return
    }
    try {
      val requestIdBytes = ByteArray(32)
      SecureRandom().nextBytes(requestIdBytes)
      val requestId = requestIdBytes.joinToString("") { "%02x".format(it) }
      val signedAt = isoUtcNow()
      val payloadHash = sha256Bytes(payloadJson.toByteArray(Charsets.UTF_8))
      val signedPayload = "lazy-armor-device-request-v1|$sessionId|$requestId|$method|$requestPath|$payloadHash|$signedAt"
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(trustedDeviceKeyPair().private)
      signature.update(signedPayload.toByteArray(Charsets.UTF_8))
      val result = Arguments.createMap()
      result.putString("requestId", requestId)
      result.putString("signedAt", signedAt)
      result.putString("payloadHash", payloadHash)
      result.putString("signature", Base64.encodeToString(signature.sign(), Base64.NO_WRAP))
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_TRUSTED_DEVICE_REQUEST_ENVELOPE_FAILED", "无法完成设备请求签名。", error)
    }
  }

  @ReactMethod
  fun createTrustedDeviceRequestId(promise: Promise) {
    try {
      val bytes = ByteArray(32)
      SecureRandom().nextBytes(bytes)
      promise.resolve(bytes.joinToString("") { "%02x".format(it) })
    } catch (error: Exception) {
      promise.reject("E_TRUSTED_DEVICE_REQUEST_ID_FAILED", "无法创建设备请求标识。", error)
    }
  }

  @ReactMethod
  fun discoverLaunchableApps(promise: Promise) {
    try {
      val packageManager = reactApplicationContext.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN, null).addCategory(Intent.CATEGORY_LAUNCHER)
      val results = packageManager.queryIntentActivities(launcherIntent, 0)
        .asSequence()
        .filter { it.activityInfo.packageName != reactApplicationContext.packageName }
        .distinctBy { it.activityInfo.packageName }
        .sortedBy { it.loadLabel(packageManager).toString().lowercase() }
        .take(maxDiscoveryResults)
        .map { resolveInfo ->
          val packageName = resolveInfo.activityInfo.packageName
          val packageInfo = packageManager.getPackageInfo(packageName, 0)
          val displayName = resolveInfo.loadLabel(packageManager).toString().take(120)
          val versionName = packageInfo.versionName?.take(120)
          val output = Arguments.createMap()
          output.putString("packageName", packageName)
          output.putString("displayName", displayName)
          output.putString("versionName", versionName)
          val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) packageInfo.longVersionCode else @Suppress("DEPRECATION") packageInfo.versionCode.toLong()
          output.putDouble("versionCode", versionCode.toDouble())
          output.putBoolean("launchable", true)
          output.putString("discoveryFingerprint", discoveryFingerprint(packageName, displayName, versionName, versionCode))
          iconDataUri(resolveInfo.loadIcon(packageManager))?.let { output.putString("iconDataUri", it) } ?: output.putNull("iconDataUri")
          output
        }
        .toList()
      val bridgeArray = Arguments.createArray()
      results.forEach { bridgeArray.pushMap(it) }
      promise.resolve(bridgeArray)
    } catch (error: Exception) {
      promise.reject("E_APP_DISCOVERY_FAILED", "无法读取这台设备的可启动应用。", error)
    }
  }

  @ReactMethod
  fun acquireNotificationSource(account: String, sourcePackage: String, start: Double, end: Double, promise: Promise) {
    try {
      LocalCapabilityManifest.activateAccount(reactApplicationContext, account)
      check(LocalCapabilityManifest.activeGrant(reactApplicationContext, "notification.read")) { "NOTIFICATION_GRANT_REQUIRED" }
      val result = LocalAcquisition.readNotificationSource(reactApplicationContext, sourcePackage, start.toLong(), end.toLong())
      promise.resolve(result.toString())
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_SOURCE_READ_FAILED", "通知来源暂时无法读取，不会当作空结果。", error)
    }
  }

  @ReactMethod
  fun openApp(packageName: String, promise: Promise) {
    if (packageName.isBlank()) {
      promise.reject("E_APP_PACKAGE_INVALID", "应用标识无效。")
      return
    }
    val intent = reactApplicationContext.packageManager.getLaunchIntentForPackage(packageName)
    if (intent == null) {
      promise.resolve(false)
      return
    }
    try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_APP_OPEN_FAILED", "无法打开该应用。", error)
    }
  }

  @ReactMethod
  fun getNotificationSourceStatus(promise: Promise) {
    try {
      val status = LazyArmorNotificationListener.status(reactApplicationContext)
      val result = Arguments.createMap()
      result.putBoolean("accessGranted", status.optBoolean("accessGranted", false))
      result.putBoolean("acquisitionEnabled", status.optBoolean("acquisitionEnabled", false))
      result.putInt("enabledPackageCount", status.optInt("enabledPackageCount", 0))
      result.putInt("pendingCount", status.optInt("pendingCount", 0))
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_STATUS_FAILED", "无法读取通知来源状态。", error)
    }
  }

  @ReactMethod
  fun openNotificationAccessSettings(promise: Promise) {
    try {
      LazyArmorNotificationListener.openNotificationAccessSettings(reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_SETTINGS_FAILED", "无法打开系统通知访问设置。", error)
    }
  }

  @ReactMethod
  fun setNotificationSourceEnabled(packageName: String, enabled: Boolean, promise: Promise) {
    try {
      if (!LazyArmorNotificationListener.setNotificationSourceEnabled(reactApplicationContext, packageName, enabled)) {
        promise.reject("E_NOTIFICATION_SOURCE_PACKAGE_INVALID", "应用标识无效。")
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_SOURCE_UPDATE_FAILED", "无法更新通知来源状态。", error)
    }
  }

  @ReactMethod
  fun drainNotificationPreviews(promise: Promise) {
    try {
      if(!LocalCapabilityManifest.activeGrant(reactApplicationContext,"notification.read")){promise.resolve(Arguments.createArray());return}
      val queue = LazyArmorNotificationListener.readQueue(reactApplicationContext)
      val results = Arguments.createArray()
      for (index in 0 until queue.length()) {
        val item = queue.optJSONObject(index) ?: continue
        val output = Arguments.createMap()
        output.putString("eventId", item.optString("eventId"))
        output.putString("contentHash", item.optString("contentHash"))
        output.putString("sourcePackage", item.optString("sourcePackage"))
        output.putDouble("postedAt", item.optLong("postedAt").toDouble())
        output.putDouble("capturedAt", item.optLong("capturedAt").toDouble())
        output.putBoolean("hasTitle", item.optBoolean("hasTitle", false))
        output.putBoolean("hasText", item.optBoolean("hasText", false))
        results.pushMap(output)
      }
      promise.resolve(results)
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_QUEUE_READ_FAILED", "无法读取待同步通知。", error)
    }
  }

  @ReactMethod
  fun acknowledgeNotificationPreviews(eventIds: ReadableArray, promise: Promise) {
    try {
      val accepted = mutableSetOf<String>()
      for (index in 0 until eventIds.size()) eventIds.getString(index)?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }?.let { accepted.add(it) }
      LazyArmorNotificationListener.acknowledge(reactApplicationContext, accepted)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_NOTIFICATION_QUEUE_ACK_FAILED", "无法确认已同步通知。", error)
    }
  }

  @ReactMethod
  fun getAppReadSessionStatus(promise: Promise) {
    try {
      val status = AppReadSessionStore.status(reactApplicationContext)
      val result = Arguments.createMap()
      result.putBoolean("active", status.optBoolean("active", false))
      if (status.isNull("sessionId")) result.putNull("sessionId") else result.putString("sessionId", status.getString("sessionId"))
      if (status.isNull("targetPackage")) result.putNull("targetPackage") else result.putString("targetPackage", status.getString("targetPackage"))
      result.putString("status", status.optString("status", "IDLE"))
      result.putDouble("expiresAt", status.optLong("expiresAt", 0).toDouble())
      result.putBoolean("usageAccessGranted", status.optBoolean("usageAccessGranted", false))
      if (status.isNull("foregroundPackage")) result.putNull("foregroundPackage") else result.putString("foregroundPackage", status.getString("foregroundPackage"))
      result.putInt("pendingEventCount", status.optInt("pendingEventCount", 0))
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_APP_READ_STATUS_FAILED", "无法读取前台会话状态。", error)
    }
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      reactApplicationContext.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_USAGE_ACCESS_SETTINGS_FAILED", "无法打开使用情况访问设置。", error)
    }
  }

  @ReactMethod
  fun startAppReadSession(sessionId: String, targetPackage: String, modes: ReadableArray, expiresAt: Double, promise: Promise) {
    try {
      check(reactApplicationContext.getSharedPreferences("lazy_armor_runtime_settings", android.content.Context.MODE_PRIVATE).getBoolean("background", true)) { "后台服务已关闭" }
      val selectedModes = (0 until modes.size()).mapNotNull { modes.getString(it) }.toSet()
      AppReadSessionStore.start(reactApplicationContext, sessionId, targetPackage, selectedModes, expiresAt.toLong())
      ContextCompat.startForegroundService(reactApplicationContext, Intent(reactApplicationContext, AppReadForegroundService::class.java))
      val launch = reactApplicationContext.packageManager.getLaunchIntentForPackage(targetPackage)
        ?: throw IllegalArgumentException("目标应用不可启动")
      reactApplicationContext.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) {
      AppReadSessionStore.stop(reactApplicationContext, "NATIVE_ERROR", "START_FAILED")
      promise.reject("E_APP_READ_START_FAILED", "无法启动受控读取会话。", error)
    }
  }

  @ReactMethod
  fun stopAppReadSession(promise: Promise) {
    AppReadSessionStore.stop(reactApplicationContext)
    reactApplicationContext.stopService(Intent(reactApplicationContext, AppReadForegroundService::class.java))
    promise.resolve(true)
  }

  @ReactMethod
  fun drainAppReadSessionEventsJson(promise: Promise) {
    try {
      promise.resolve(AppReadSessionStore.readEvents(reactApplicationContext).toString())
    } catch (error: Exception) {
      promise.reject("E_APP_READ_EVENTS_FAILED", "无法读取前台会话事件。", error)
    }
  }

  @ReactMethod
  fun acknowledgeAppReadSessionEvents(eventKeys: ReadableArray, promise: Promise) {
    try {
      val keys = mutableSetOf<String>()
      for (index in 0 until eventKeys.size()) {
        eventKeys.getString(index)?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }?.let { keys.add(it) }
      }
      AppReadSessionStore.acknowledge(reactApplicationContext, keys)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_APP_READ_ACK_FAILED", "无法确认前台会话事件。", error)
    }
  }

  @ReactMethod
  fun captureAppReadUiNodes(targetPackage: String, allowedSelectors: ReadableArray, promise: Promise) {
    try {
      val selectors = (0 until allowedSelectors.size()).mapNotNull { allowedSelectors.getString(it) }.toSet()
      promise.resolve(AppReadSessionStore.captureUiNodes(reactApplicationContext, targetPackage, selectors).toString())
    } catch (error: Exception) {
      promise.reject("E_APP_READ_UI_NODES_UNAVAILABLE", "无法读取目标应用的可控节点。", error)
    }
  }

  private fun trustedDeviceKeyPair(): KeyPair {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existingPrivate = keyStore.getKey(trustedDeviceKeyAlias, null) as? java.security.PrivateKey
    val existingPublic = keyStore.getCertificate(trustedDeviceKeyAlias)?.publicKey
    if (existingPrivate != null && existingPublic != null) return KeyPair(existingPublic, existingPrivate)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(trustedDeviceKeyAlias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
      .build()
    generator.initialize(spec)
    return generator.generateKeyPair()
  }

  private fun sha256Bytes(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }

  private fun isoUtcNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

  private fun discoveryFingerprint(packageName: String, displayName: String, versionName: String?, versionCode: Long): String {
    val data = "$packageName|$displayName|${versionName ?: ""}|$versionCode|launchable"
    return sha256Bytes(data.toByteArray(Charsets.UTF_8))
  }

  private fun iconDataUri(drawable: Drawable): String? {
    return try {
      val bitmap = Bitmap.createBitmap(iconSizePx, iconSizePx, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      drawable.setBounds(0, 0, iconSizePx, iconSizePx)
      drawable.draw(canvas)
      val bytes = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
      val encoded = bytes.toByteArray()
      if (encoded.size > maxIconBytes) null else "data:image/png;base64,${Base64.encodeToString(encoded, Base64.NO_WRAP)}"
    } catch (_: Exception) {
      null
    }
  }
}
