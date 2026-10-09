package com.lazyarmor.app

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.graphics.Rect
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/** On-demand, exact-selector read only. No screenshots, actions or content event queue. */
class ReadOnlyPageObserver : AccessibilityService() {
  companion object {
    @Volatile private var instance: ReadOnlyPageObserver? = null
    private val sensitive = Regex("password|passwd|pwd|pin|otp|verification.?code|cvv|private.?key|recovery.?phrase|secret|token|cookie|credential", RegexOption.IGNORE_CASE)
    fun permissionGranted(context: Context): Boolean {
      val expected = ComponentName(context, ReadOnlyPageObserver::class.java)
      return (Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: "")
        .split(':').mapNotNull { ComponentName.unflattenFromString(it) }.any { it == expected }
    }
    fun connected(context: Context) = instance != null && permissionGranted(context)
    fun validateTicket(context: Context, task: JSONObject): JSONObject {
      require(android.os.Build.VERSION.SDK_INT >= 26 && task.optString("taskType") == "APP_STRUCTURED_READ")
      require(task.optString("status") in listOf("CLAIMED", "RUNNING"))
      val ticket = task.getJSONObject("dispatchAuthorization")
      val bytes = Base64.decode(ticket.getString("payload"), Base64.NO_WRAP)
      require(bytes.size <= 16000 && BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY.isNotEmpty())
      val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY, Base64.NO_WRAP)))
      val verifier = Signature.getInstance("SHA256withECDSA"); verifier.initVerify(key); verifier.update(bytes)
      require(verifier.verify(Base64.decode(ticket.getString("signature"), Base64.NO_WRAP)))
      val claims = JSONObject(String(bytes, Charsets.UTF_8))
      require(claims.getString("version") == "ui-observation.v1" && claims.getString("taskId") == task.getString("id")
        && claims.getString("claimToken") == task.getString("claimToken"))
      val payload = task.getJSONObject("payload")
      require(payload.getString("packageName") == claims.getString("packageName") && payload.getString("appReadSessionId") == claims.getString("sessionId"))
      require(java.time.OffsetDateTime.parse(claims.getString("expiresAt")).toInstant().toEpochMilli() > System.currentTimeMillis())
      val session = AppReadSessionStore.active(context) ?: throw IllegalStateException("SESSION_STOPPED")
      require(claims.getString("userId") == LocalCapabilityManifest.activeAccount(context) && session.optString("accountId") == claims.getString("userId"))
      require(session.optString("sessionId") == claims.getString("sessionId") && AppReadSessionStore.hasMode(session, "UI_READ")
        && session.optString("targetPackage") == claims.getString("packageName") && session.optString("sourceVersion") == claims.getString("sourceVersion"))
      return claims
    }
    fun capture(context: Context, task: JSONObject): JSONObject {
      val claims = validateTicket(context, task)
      val service = instance ?: throw IllegalStateException("OBSERVER_DISCONNECTED")
      return service.read(context, claims)
    }
  }

  override fun onServiceConnected() { instance = this; super.onServiceConnected() }
  override fun onInterrupt() { AppReadSessionStore.stop(applicationContext, "NATIVE_ERROR", "OBSERVER_INTERRUPTED") }
  override fun onUnbind(intent: android.content.Intent?): Boolean {
    instance = null; AppReadSessionStore.stop(applicationContext, "NATIVE_ERROR", "OBSERVER_DISCONNECTED")
    return super.onUnbind(intent)
  }
  override fun onDestroy() { instance = null; super.onDestroy() }
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // Window events check foreground only. Text is never read or buffered here.
    val session = AppReadSessionStore.active(applicationContext) ?: return
    if (!AppReadSessionStore.hasMode(session, "UI_READ")) return
    if (session.optString("status") == "READING" && event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
      && event.packageName?.toString() != session.optString("targetPackage")) {
      AppReadSessionStore.stop(applicationContext, "FOREGROUND_LOST", "FOREGROUND_PACKAGE_MISMATCH")
    }
  }

  private fun assertCurrent(context: Context, claims: JSONObject): JSONObject {
    require(java.time.OffsetDateTime.parse(claims.getString("expiresAt")).toInstant().toEpochMilli() > System.currentTimeMillis()) { "STALE_CLAIM" }
    val session = AppReadSessionStore.active(context) ?: throw IllegalStateException("SESSION_STOPPED")
    val account = LocalCapabilityManifest.activeAccount(context)
    require(account != null && account == claims.getString("userId") && session.optString("accountId") == account)
    require(session.optString("sessionId") == claims.getString("sessionId") && AppReadSessionStore.hasMode(session, "UI_READ"))
    require(session.optString("status") == "READING" && session.optString("targetPackage") == claims.getString("packageName"))
    require(session.optString("sourceVersion") == claims.getString("sourceVersion"))
    require(session.optLong("packageVersionCode") == AppReadSessionStore.packageVersionCode(context, claims.getString("packageName"))) { "APP_VERSION_CHANGED" }
    require(LocalCapabilityManifest.activeGrant(context, "accessibility.read") && connected(context) && ForegroundPackageGuard.hasUsageAccess(context))
    require(ForegroundPackageGuard.currentPackage(context) == claims.getString("packageName"))
    return session
  }

  private fun read(context: Context, claims: JSONObject): JSONObject {
    val session = assertCurrent(context, claims)
    val allowed = session.getJSONArray("requestedFields").let { array -> (0 until array.length()).map { array.getString(it) }.toSet() }
    val requested = claims.getJSONArray("requestedFields").let { array -> (0 until array.length()).map { array.getString(it) } }
    require(requested.isNotEmpty() && requested.size <= 30 && requested.toSet().size == requested.size
      && requested.all { it in allowed && it.length <= 255 && !it.contains('*') && !sensitive.containsMatchIn(it) })
    val root = rootInActiveWindow ?: throw IllegalStateException("PAGE_UNAVAILABLE")
    require(root.packageName?.toString() == claims.getString("packageName"))
    val found = linkedMapOf<String, JSONObject>()
    var visited = 0
    fun walk(node: AccessibilityNodeInfo, depth: Int) {
      require(++visited <= 512 && depth <= 30) { "PAGE_BOUND_EXCEEDED" }
      if (node.packageName?.toString() != claims.getString("packageName") || node.isPassword || node.isEditable) return
      val id = node.viewIdResourceName.orEmpty()
      val description = node.contentDescription?.toString().orEmpty()
      if (sensitive.containsMatchIn(id) || sensitive.containsMatchIn(description)) return
      // Exact ID or exact semantic accessibility label, never substring/text guessing.
      val selector = requested.firstOrNull { it == id || it == description }
      if (selector != null && node.isVisibleToUser) {
        require(!found.containsKey(selector)) { "AMBIGUOUS_SELECTOR" }
        val text = node.text?.toString().orEmpty()
        require(text.length <= 256 && description.length <= 256) { "FIELD_BOUND_EXCEEDED" }
        if (text.isNotBlank()) {
          val bounds = Rect(); node.getBoundsInScreen(bounds)
          found[selector] = JSONObject().put("resourceId", selector).put("text", text).put("role", node.className?.toString())
            .put("enabled", node.isEnabled).put("selected", node.isSelected)
            .put("bounds", JSONObject().put("left", bounds.left).put("top", bounds.top).put("right", bounds.right).put("bottom", bounds.bottom))
        }
      }
      for (i in 0 until node.childCount) node.getChild(i)?.let { child -> try { walk(child, depth + 1) } finally { child.recycle() } }
    }
    try { walk(root, 0) } finally { root.recycle() }
    require(rootInActiveWindow?.let { current -> try { current.packageName?.toString() == claims.getString("packageName") } finally { current.recycle() } } == true)
    require(assertCurrent(context, claims).toString() == session.toString()) { "SESSION_CHANGED_DURING_READ" }
    val nodes = JSONArray(found.values.toList())
    val observedAt = System.currentTimeMillis()
    val hash = MessageDigest.getInstance("SHA-256").digest((claims.getString("taskId") + "|" + claims.getString("sessionId") + "|" + observedAt + "|" + nodes).toByteArray()).joinToString("") { "%02x".format(it) }
    return JSONObject().put("nodes", nodes).put("evidenceHash", hash).put("observedAt", observedAt)
  }
}
