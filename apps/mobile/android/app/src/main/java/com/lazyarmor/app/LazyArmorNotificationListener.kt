package com.lazyarmor.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Generic notification source boundary. Android grants listener access separately;
 * users then opt in each already-connected app. Notification text never leaves
 * process memory and is represented only by a non-reversible content fingerprint.
 */
class LazyArmorNotificationListener : NotificationListenerService() {
  companion object {
    private const val PREFERENCES = "lazy_armor_notification_source"
    private const val QUEUE_KEY = "notification_preview_queue"
    private const val ENABLED_PACKAGES_KEY = "enabled_notification_packages"
    private const val MAX_QUEUE_SIZE = 50

    fun status(context: Context): JSONObject {
      val result = JSONObject()
      result.put("accessGranted", notificationAccessGranted(context))
      result.put("enabledPackageCount", enabledPackages(context).size)
      result.put("pendingCount", readQueue(context).length())
      return result
    }

    fun setNotificationSourceEnabled(context: Context, packageName: String, enabled: Boolean): Boolean {
      if (packageName.isBlank() || packageName == context.packageName) return false
      val packages = enabledPackages(context).toMutableSet()
      if (enabled) packages.add(packageName) else packages.remove(packageName)
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(ENABLED_PACKAGES_KEY, JSONArray(packages.sorted()).toString()).apply()
      if (!enabled) removePackagePreviews(context, packageName)
      return true
    }

    fun openNotificationAccessSettings(context: Context) {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun readQueue(context: Context): JSONArray {
      val raw = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(QUEUE_KEY, "[]") ?: "[]"
      return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    fun acknowledge(context: Context, eventIds: Set<String>) {
      if (eventIds.isEmpty()) return
      val retained = JSONArray()
      val queue = readQueue(context)
      for (index in 0 until queue.length()) {
        val item = queue.optJSONObject(index) ?: continue
        if (!eventIds.contains(item.optString("eventId"))) retained.put(item)
      }
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(QUEUE_KEY, retained.toString()).apply()
    }

    private fun enabledPackages(context: Context): Set<String> {
      val raw = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(ENABLED_PACKAGES_KEY, "[]") ?: "[]"
      val items = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
      return (0 until items.length()).mapNotNull { items.optString(it).takeIf { value -> value.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")) } }.toSet()
    }

    private fun notificationAccessGranted(context: Context): Boolean {
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
      return flat.split(':').mapNotNull { ComponentName.unflattenFromString(it) }.any { it.packageName == context.packageName }
    }

    private fun appendPreview(context: Context, preview: JSONObject) {
      val queue = readQueue(context)
      val retained = JSONArray()
      val startIndex = maxOf(0, queue.length() - (MAX_QUEUE_SIZE - 1))
      for (index in startIndex until queue.length()) retained.put(queue.optJSONObject(index))
      retained.put(preview)
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(QUEUE_KEY, retained.toString()).apply()
    }

    private fun removePackagePreviews(context: Context, packageName: String) {
      val retained = JSONArray()
      val queue = readQueue(context)
      for (index in 0 until queue.length()) {
        val item = queue.optJSONObject(index) ?: continue
        if (item.optString("sourcePackage") != packageName) retained.put(item)
      }
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(QUEUE_KEY, retained.toString()).apply()
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  }

  override fun onNotificationPosted(notification: StatusBarNotification) {
    if (!enabledPackages(applicationContext).contains(notification.packageName)) return
    val extras = notification.notification.extras ?: return
    val title = extras.getCharSequence("android.title")?.toString().orEmpty()
    val body = extras.getCharSequence("android.text")?.toString().orEmpty()
    val capturedAt = System.currentTimeMillis()
    val eventId = sha256("${notification.packageName}|${notification.key}|${notification.postTime}")
    val contentHash = sha256("$title\n$body")
    val preview = JSONObject()
    preview.put("eventId", eventId)
    preview.put("contentHash", contentHash)
    preview.put("sourcePackage", notification.packageName)
    preview.put("postedAt", notification.postTime)
    preview.put("capturedAt", capturedAt)
    preview.put("hasTitle", title.isNotBlank())
    preview.put("hasText", body.isNotBlank())
    appendPreview(applicationContext, preview)
  }
}
