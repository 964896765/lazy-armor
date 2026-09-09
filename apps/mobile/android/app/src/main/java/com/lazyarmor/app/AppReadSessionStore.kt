package com.lazyarmor.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

object AppReadSessionStore {
  private const val PREFERENCES = "lazy_armor_app_read_session"
  private const val SESSION_KEY = "active_session"
  private const val EVENTS_KEY = "session_events"
  private const val MAX_EVENTS = 80
  private val packagePattern = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")

  fun start(context: Context, sessionId: String, targetPackage: String, modes: Set<String>, expiresAt: Long): JSONObject {
    require(sessionId.isNotBlank() && targetPackage.matches(packagePattern))
    require(modes.isNotEmpty() && modes.all { it == "NOTIFICATION" || it == "SHARE" })
    val now = System.currentTimeMillis()
    require(expiresAt in (now + 5_000)..(now + 15 * 60 * 1000))
    val session = JSONObject()
      .put("sessionId", sessionId)
      .put("targetPackage", targetPackage)
      .put("modes", JSONArray(modes.sorted()))
      .put("status", "WAITING_FOREGROUND")
      .put("expiresAt", expiresAt)
      .put("startedAt", now)
    preferences(context).edit().putString(SESSION_KEY, session.toString()).putString(EVENTS_KEY, "[]").apply()
    appendLifecycle(context, "SESSION_STARTED", targetPackage, JSONObject().put("nativeStatus", "WAITING_FOREGROUND"))
    return session
  }

  fun status(context: Context): JSONObject {
    val session = active(context) ?: return JSONObject().put("active", false).put("usageAccessGranted", ForegroundPackageGuard.hasUsageAccess(context))
    return JSONObject(session.toString())
      .put("active", true)
      .put("usageAccessGranted", ForegroundPackageGuard.hasUsageAccess(context))
      .put("foregroundPackage", ForegroundPackageGuard.currentPackage(context))
      .put("pendingEventCount", readEvents(context).length())
  }

  fun active(context: Context): JSONObject? {
    val raw = preferences(context).getString(SESSION_KEY, null) ?: return null
    val session = try { JSONObject(raw) } catch (_: Exception) { return null }
    if (session.optLong("expiresAt") <= System.currentTimeMillis()) {
      appendLifecycle(context, "SESSION_TIMED_OUT", session.optString("targetPackage"), JSONObject())
      clearSession(context)
      return null
    }
    return session
  }

  fun updateStatus(context: Context, status: String) {
    val session = active(context) ?: return
    session.put("status", status)
    preferences(context).edit().putString(SESSION_KEY, session.toString()).apply()
  }

  fun stop(context: Context, eventType: String = "SESSION_STOPPED", reason: String = "USER_STOPPED") {
    val session = active(context) ?: return
    appendLifecycle(context, eventType, session.optString("targetPackage"), JSONObject().put("reason", reason))
    clearSession(context)
  }

  fun isReadingTarget(context: Context, packageName: String, mode: String): Boolean {
    val session = active(context) ?: return false
    val modes = session.optJSONArray("modes") ?: return false
    return session.optString("status") == "READING" &&
      session.optString("targetPackage") == packageName &&
      (0 until modes.length()).any { modes.optString(it) == mode }
  }

  fun appendLifecycle(context: Context, eventType: String, packageName: String, payload: JSONObject) {
    val session = activeWithoutExpiry(context) ?: return
    append(context, JSONObject()
      .put("sessionId", session.optString("sessionId"))
      .put("eventKey", sha256(session.optString("sessionId") + "|" + eventType + "|" + System.nanoTime()))
      .put("eventType", eventType)
      .put("packageName", packageName)
      .put("observedAt", System.currentTimeMillis())
      .put("payload", payload)
      .put("evidenceHash", JSONObject.NULL)
      .put("candidateKind", "unknown"))
  }

  fun capture(context: Context, eventType: String, packageName: String, title: String, body: String) {
    val requiredMode = if (eventType == "NOTIFICATION_CAPTURED") "NOTIFICATION" else "SHARE"
    if (!isReadingTarget(context, packageName, requiredMode)) return
    val session = active(context) ?: return
    val candidate = GenericNotificationNormalizer.normalize(title, body)
    val contentHash = sha256(title + "\n" + body)
    val observedAt = System.currentTimeMillis()
    val payload = JSONObject()
      .put("hasTitle", title.isNotBlank())
      .put("hasText", body.isNotBlank())
      .put("parserVersion", candidate.parserVersion)
    append(context, JSONObject()
      .put("sessionId", session.optString("sessionId"))
      .put("eventKey", sha256(session.optString("sessionId") + "|" + eventType + "|" + packageName + "|" + observedAt + "|" + contentHash))
      .put("eventType", eventType)
      .put("packageName", packageName)
      .put("observedAt", observedAt)
      .put("payload", payload)
      .put("evidenceHash", contentHash)
      .put("candidateKind", candidate.kind)
      .put("amountMinor", candidate.amountMinor)
      .put("currency", candidate.currency))
  }

  fun readEvents(context: Context): JSONArray {
    val raw = preferences(context).getString(EVENTS_KEY, "[]") ?: "[]"
    return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
  }

  fun acknowledge(context: Context, eventKeys: Set<String>) {
    if (eventKeys.isEmpty()) return
    val retained = JSONArray()
    val queue = readEvents(context)
    for (index in 0 until queue.length()) {
      val item = queue.optJSONObject(index) ?: continue
      if (!eventKeys.contains(item.optString("eventKey"))) retained.put(item)
    }
    preferences(context).edit().putString(EVENTS_KEY, retained.toString()).apply()
  }

  private fun append(context: Context, event: JSONObject) {
    val queue = readEvents(context)
    val retained = JSONArray()
    val start = maxOf(0, queue.length() - (MAX_EVENTS - 1))
    for (index in start until queue.length()) retained.put(queue.optJSONObject(index))
    retained.put(event)
    preferences(context).edit().putString(EVENTS_KEY, retained.toString()).apply()
  }

  private fun activeWithoutExpiry(context: Context): JSONObject? {
    val raw = preferences(context).getString(SESSION_KEY, null) ?: return null
    return try { JSONObject(raw) } catch (_: Exception) { null }
  }

  private fun clearSession(context: Context) {
    preferences(context).edit().remove(SESSION_KEY).apply()
  }

  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
