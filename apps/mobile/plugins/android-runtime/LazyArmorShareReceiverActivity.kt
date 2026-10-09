package com.lazyarmor.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class LazyArmorShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    receive(intent)
    if (intent?.action in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE)) {
      val mime=intent.type.orEmpty()
      if(mime=="text/plain"||mime=="text/html"||mime.startsWith("image/")||mime=="application/pdf") {
        val text=if(mime=="text/html")intent.getStringExtra(Intent.EXTRA_HTML_TEXT)?:intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty() else intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        val childIds=mutableListOf<String>()
        @Suppress("DEPRECATION")
        val streams=if(intent.action==Intent.ACTION_SEND_MULTIPLE)intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty() else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        var failed=streams.size>5
        for(uri in streams.take(5)) {
          if(uri.scheme!="content"){failed=true;continue}
          try {
            val actualMime=contentResolver.getType(uri)?:mime
            if(!(actualMime.startsWith("image/")||actualMime=="application/pdf")){failed=true;continue}
            val bytes=contentResolver.openInputStream(uri)?.use { val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(output.size()<=2000000){val count=it.read(buffer);if(count<0)break;output.write(buffer,0,count)};output.toByteArray() }?:continue
            val fileName=if(actualMime=="application/pdf")"shared-document.pdf" else if(actualMime=="image/png")"shared-image.png" else "shared-image.jpg"
            val captured=ArtifactShareReceipt.capture(applicationContext,"",actualMime,bytes,fileName);if(captured==null)failed=true else childIds.add(captured)
          }catch(_:Exception) { failed=true }
        }
        if(failed){android.widget.Toast.makeText(applicationContext,"分享读取未完成：最多 5 个文件，每份不超过 2 MB；未保存部分结果",android.widget.Toast.LENGTH_LONG).show();finish();return}
        val receiptId=if(text.isNotBlank()&&text.length<=12000)ArtifactShareReceipt.capture(applicationContext,text,if(mime=="text/html")"text/html" else "text/plain",children=childIds) else childIds.firstOrNull()
        if(receiptId!=null){
          if(text.isBlank())ArtifactShareReceipt.attachChildren(receiptId,childIds.drop(1))
          val target=Uri.Builder().scheme("lazyarmor").authority("").path("/add-external-reference").appendQueryParameter("shareReceiptId",receiptId).build()
          startActivity(Intent(Intent.ACTION_VIEW,target).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
          finish();return
        }
      }
    }
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
