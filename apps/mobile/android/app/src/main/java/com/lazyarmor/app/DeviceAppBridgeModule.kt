package com.lazyarmor.app

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * Device-level bridge for user-initiated Generic App Connection flows.
 * Discovery asks Android for launchable applications only. It does not use
 * QUERY_ALL_PACKAGES, does not infer providers, and does not persist an app inventory.
 */
class DeviceAppBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val maxDiscoveryResults = 200
  private val iconSizePx = 48
  private val maxIconBytes = 24_000

  override fun getName(): String = "LazyArmorDeviceBridge"

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

  private fun discoveryFingerprint(packageName: String, displayName: String, versionName: String?, versionCode: Long): String {
    val data = "$packageName|$displayName|${versionName ?: ""}|$versionCode|launchable"
    return MessageDigest.getInstance("SHA-256").digest(data.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
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
