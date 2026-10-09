package com.lazyarmor.app

import android.Manifest
import android.app.usage.UsageStatsManager
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** User initiated, bounded OS reads. Failure is never an empty success. */
object LocalAcquisition {
 const val MANIFEST_VERSION = "android-local-v1"
 fun readNotificationSource(context:Context,sourcePackage:String,start:Long,end:Long):JSONObject {
  require(start>=0 && end>start && end-start<=7L*86400000L) { "INVALID_NOTIFICATION_SCOPE" }
  val items=LazyArmorNotificationListener.snapshotSource(context,sourcePackage,start,end)
  val bytes=items.toString()
  val hash=MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  return JSONObject().put("manifestVersion",MANIFEST_VERSION).put("capability","notification.read").put("observedAt",System.currentTimeMillis())
   .put("scopeStart",start).put("scopeEnd",end).put("items",items).put("itemCount",items.length()).put("contentJson",bytes).put("contentHash",hash)
   .put("state",if(items.length()==0)"VERIFIED_EMPTY" else "VERIFIED_PRESENT").put("reason","已读取授权应用的真实通知范围")
 }

 private fun granted(context:Context,permission:String)=ContextCompat.checkSelfPermission(context,permission)==PackageManager.PERMISSION_GRANTED
 fun read(context:Context,capability:String,start:Long,end:Long):JSONObject {
  val result=JSONObject().put("manifestVersion",MANIFEST_VERSION).put("capability",capability).put("observedAt",System.currentTimeMillis()).put("scopeStart",start).put("scopeEnd",end)
  if(start<0||end<=start||end-start>31L*86400000L)return result.put("state","UNAVAILABLE").put("reason","读取范围无效")
  val items=JSONArray()
  try {
   when(capability) {
    "network.status" -> {
     val manager=context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
     val network=manager.activeNetwork
     val caps=network?.let {manager.getNetworkCapabilities(it)}
     items.put(JSONObject().put("connected",network!=null).put("internetValidated",caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)?:false))
    }
    "battery.status" -> {
     val battery=context.registerReceiver(null,android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))?:return result.put("state","UNAVAILABLE").put("reason","电池服务未返回状态")
     val level=battery.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL,-1);val scale=battery.getIntExtra(android.os.BatteryManager.EXTRA_SCALE,-1)
     if(level<0||scale<=0)return result.put("state","UNKNOWN").put("reason","电池状态不可验证")
     items.put(JSONObject().put("level",level).put("scale",scale).put("status",battery.getIntExtra(android.os.BatteryManager.EXTRA_STATUS,-1)))
    }
    "calendar.read" -> {
     if(!granted(context,Manifest.permission.READ_CALENDAR))return result.put("state","PERMISSION_REQUIRED").put("reason","需要日历读取授权")
     val builder=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(builder,start);ContentUris.appendId(builder,end)
     val cursor=context.contentResolver.query(builder.build(),arrayOf(CalendarContract.Instances.EVENT_ID,CalendarContract.Instances.TITLE,CalendarContract.Instances.BEGIN,CalendarContract.Instances.END,CalendarContract.Instances.CALENDAR_ID,CalendarContract.Instances.STATUS,CalendarContract.Instances.ALL_DAY),null,null,CalendarContract.Instances.BEGIN+" ASC")?:return result.put("state","UNAVAILABLE").put("reason","日历提供方未返回读取结果")
     cursor.use { while(it.moveToNext()&&items.length()<500)items.put(JSONObject().put("id",it.getLong(0).toString()).put("title",it.getString(1)?:"").put("startAt",it.getLong(2)).put("endAt",it.getLong(3)).put("calendarId",it.getLong(4).toString()).put("allDay",it.getInt(6)==1).put("status",when(it.getInt(5)){2->"CANCELLED";0->"TENTATIVE";else->"SCHEDULED"})) }
    }
    "contacts.read" -> {
     if(!granted(context,Manifest.permission.READ_CONTACTS))return result.put("state","PERMISSION_REQUIRED").put("reason","需要通讯录读取授权")
     val cursor=context.contentResolver.query(ContactsContract.Contacts.CONTENT_URI,arrayOf(ContactsContract.Contacts._ID,ContactsContract.Contacts.DISPLAY_NAME_PRIMARY),null,null,ContactsContract.Contacts._ID+" ASC")?:return result.put("state","UNAVAILABLE").put("reason","通讯录未返回读取结果")
     cursor.use {while(it.moveToNext()&&items.length()<500)items.put(JSONObject().put("id",it.getString(0)).put("displayName",it.getString(1)?:""))}
    }
    "appusage.read" -> {
     if(!ForegroundPackageGuard.hasUsageAccess(context))return result.put("state","PERMISSION_REQUIRED").put("reason","需要使用情况读取授权")
     val manager=context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
     val rows=manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY,start,end)?:return result.put("state","UNAVAILABLE").put("reason","使用情况未返回读取结果")
     for(row in rows.take(500))items.put(JSONObject().put("packageName",row.packageName).put("lastUsedAt",row.lastTimeUsed).put("foregroundMs",row.totalTimeInForeground))
    }
    "location.read" -> {
     if(!granted(context,Manifest.permission.ACCESS_COARSE_LOCATION)&&!granted(context,Manifest.permission.ACCESS_FINE_LOCATION))return result.put("state","PERMISSION_REQUIRED").put("reason","需要位置读取授权")
     val manager=context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
     val location=manager.getProviders(true).mapNotNull {provider->try{manager.getLastKnownLocation(provider)}catch(_:SecurityException){null}}.maxByOrNull{it.time}
     if(location==null)return result.put("state","UNKNOWN").put("reason","尚未取得位置证据")
     result.put("observedAt",location.time)
     if(System.currentTimeMillis()-location.time>300000L)return result.put("state","STALE").put("reason","已有位置证据已过期")
     items.put(JSONObject().put("latitude",location.latitude).put("longitude",location.longitude).put("accuracyMeters",location.accuracy.toDouble()))
    }
    "notification.read" -> {
     if(!LazyArmorNotificationListener.status(context).optBoolean("accessGranted"))return result.put("state","PERMISSION_REQUIRED").put("reason","需要系统通知读取授权")
     // A preview queue is partial observation, not proof that the user's notifications are empty.
     return result.put("state","UNKNOWN").put("reason","通知预览不代表完整读取；使用现有通知证据链确认")
    }
    "files.read" -> return result.put("state","PERMISSION_REQUIRED").put("reason","请通过系统文件选择器选择文件，复用 Artifact 导入")
    "share.read" -> return result.put("state","UNKNOWN").put("reason","请从其它应用分享具体内容，复用 Share Intent 证据链")
    else -> return result.put("state","UNAVAILABLE").put("reason","此读取能力尚未开放")
   }
   val hash=MessageDigest.getInstance("SHA-256").digest(items.toString().toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 0xff)}
   return result.put("state",if(items.length()==0)"VERIFIED_EMPTY" else "VERIFIED_PRESENT").put("items",items).put("itemCount",items.length()).put("contentHash",hash).put("contentJson",items.toString()).put("truncated",items.length()>=500)
  }catch(_:SecurityException){return result.put("state","PERMISSION_REQUIRED").put("reason","读取授权已失效")}
  catch(_:Exception){return result.put("state","UNAVAILABLE").put("reason","本轮系统读取失败，不能判断是否有数据")}
 }
}
