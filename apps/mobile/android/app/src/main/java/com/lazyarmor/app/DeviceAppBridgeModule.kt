package com.lazyarmor.app

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Device-level capability boundary for a deliberately small, reviewed app catalog.
 * It never enumerates the device inventory and rejects packages outside this allowlist.
 */
class DeviceAppBridgeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val supportedPackages = setOf(
    "com.greenpoint.android.mc10086.activity",
    "com.tencent.mm",
    "com.eg.android.AlipayGphone",
    "com.taobao.taobao",
    "com.google.android.gm",
    "com.google.android.calendar",
  )

  override fun getName(): String = "LazyArmorDeviceBridge"

  @ReactMethod
  fun detectSupportedApps(packageNames: ReadableArray, promise: Promise) {
    try {
      val results = Arguments.createArray()
      val packageManager = reactApplicationContext.packageManager
      for (index in 0 until packageNames.size()) {
        val packageName = packageNames.getString(index) ?: continue
        if (!supportedPackages.contains(packageName)) continue
        val result = Arguments.createMap()
        result.putString("packageName", packageName)
        try {
          val info = packageManager.getApplicationInfo(packageName, 0)
          result.putBoolean("installed", info.enabled)
          result.putString("displayName", packageManager.getApplicationLabel(info).toString())
        } catch (_: Exception) {
          result.putBoolean("installed", false)
          result.putNull("displayName")
        }
        results.pushMap(result)
      }
      promise.resolve(results)
    } catch (error: Exception) {
      promise.reject("E_PACKAGE_DETECTION_FAILED", "无法读取已支持应用的安装状态。", error)
    }
  }

  @ReactMethod
  fun openSupportedApp(packageName: String, promise: Promise) {
    if (!supportedPackages.contains(packageName)) {
      promise.reject("E_PACKAGE_NOT_ALLOWED", "该应用不在已支持目录中。")
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
}
