package com.lazyarmor.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process

object ForegroundPackageGuard {
  fun hasUsageAccess(context: Context): Boolean {
    val manager = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = manager.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    return mode == AppOpsManager.MODE_ALLOWED
  }

  fun currentPackage(context: Context): String? {
    if (!hasUsageAccess(context)) return null
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    return manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, end - 20_000, end)
      .maxByOrNull { it.lastTimeUsed }?.packageName
  }
}
