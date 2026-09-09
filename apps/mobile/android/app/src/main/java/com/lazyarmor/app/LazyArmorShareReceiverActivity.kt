package com.lazyarmor.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class LazyArmorShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    receive(intent)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(Intent.ACTION_VIEW, Uri.parse("lazyarmor://app-read-session"))
    startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
    finish()
  }

  private fun receive(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
    val session = AppReadSessionStore.active(applicationContext) ?: return
    val expected = session.optString("targetPackage")
    val source = referrer?.takeIf { it.scheme == "android-app" }?.host ?: callingPackage ?: return
    if (source != expected) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
    if (text.isBlank() && subject.isBlank()) return
    AppReadSessionStore.capture(applicationContext, "SHARE_CAPTURED", source, subject, text)
  }
}
