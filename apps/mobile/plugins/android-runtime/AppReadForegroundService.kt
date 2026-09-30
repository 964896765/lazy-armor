package com.lazyarmor.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

class AppReadForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      inspectForeground()
      if (AppReadSessionStore.active(applicationContext) != null) handler.postDelayed(this, 5_000)
      else stopSelf()
    }
  }

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("app_read_session", "受控读取会话", NotificationManager.IMPORTANCE_LOW))
    val notification = NotificationCompat.Builder(this, "app_read_session")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("懒人装甲正在验证目标应用")
      .setContentText("只在目标应用位于前台时接收已授权线索")
      .setOngoing(true).build()
    startForeground(4102, notification)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun inspectForeground() {
    val session = AppReadSessionStore.active(applicationContext) ?: return
    if (!ForegroundPackageGuard.hasUsageAccess(applicationContext)) {
      AppReadSessionStore.stop(applicationContext, "NATIVE_ERROR", "USAGE_ACCESS_REQUIRED")
      return
    }
    val target = session.optString("targetPackage")
    val observed = ForegroundPackageGuard.currentPackage(applicationContext)
    val status = session.optString("status")
    if (observed == target && status != "READING") {
      AppReadSessionStore.updateStatus(applicationContext, "READING")
      AppReadSessionStore.appendLifecycle(applicationContext, "FOREGROUND_CONFIRMED", target, org.json.JSONObject().put("foregroundPackage", observed))
    } else if (status == "READING" && observed != target) {
      AppReadSessionStore.stop(applicationContext, "FOREGROUND_LOST", "FOREGROUND_PACKAGE_MISMATCH")
    } else {
      AppReadSessionStore.appendLifecycle(applicationContext, "HEARTBEAT", target, org.json.JSONObject()
        .put("foregroundPackage", observed).put("nativeStatus", status).put("usageAccessGranted", true))
    }
  }
}
