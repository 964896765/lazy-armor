package com.lazyarmor.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object LocalCapabilityManifest {
 fun activeAccount(context:Context)=context.getSharedPreferences("lazy_armor_local_account",Context.MODE_PRIVATE).getString("account",null)
 fun activateAccount(context:Context,account:String?){
  if(activeAccount(context)!=account){LazyArmorNotificationListener.clearAccountState(context);AppReadSessionStore.clearAccountState(context)}
  context.getSharedPreferences("lazy_armor_local_account",Context.MODE_PRIVATE).edit().apply {if(account==null)remove("account") else putString("account",account)}.commit()
 }
 fun activeGrant(context:Context,key:String):Boolean {val account=activeAccount(context)?:return false;return granted(context,account,key)}
 val keys=listOf("notification.read","calendar.read","contacts.read","files.read","photos.read","appusage.read","location.read","sms.read","share.read","notification.send","app.open","background.task","appread.session","voice.input","calendar.create","calendar.update","calendar.delete","media.pick","camera.capture","clipboard.read_on_demand","deep_link.open","network.status","battery.status","calllog.read","location.background","accessibility.read")
 private fun prefs(context:Context,account:String)=context.getSharedPreferences("lazy_armor_local_grants_"+account,Context.MODE_PRIVATE)
 fun granted(context:Context,account:String,key:String)=prefs(context,account).getBoolean(key,false)
 fun setGrant(context:Context,account:String,key:String,value:Boolean){require(key in keys);require(activeAccount(context)==account);if(key=="notification.read"&&!value)LazyArmorNotificationListener.clearPreviews(context);if(key=="accessibility.read"&&granted(context,account,key)!=value)AppReadSessionStore.stop(context,"NATIVE_ERROR","UI_READ_GRANT_CHANGED");prefs(context,account).edit().putBoolean(key,value).commit()}
 private fun permission(context:Context,key:String):String {
  if(key in listOf("calendar.create","calendar.update","calendar.delete"))return if(listOf(Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR).all {ContextCompat.checkSelfPermission(context,it)==PackageManager.PERMISSION_GRANTED})"GRANTED" else "DENIED"
  val p=when(key){"calendar.read"->Manifest.permission.READ_CALENDAR;"contacts.read"->Manifest.permission.READ_CONTACTS;"location.read"->Manifest.permission.ACCESS_COARSE_LOCATION;"voice.input"->Manifest.permission.RECORD_AUDIO;else->null}
  if(p!=null)return if(ContextCompat.checkSelfPermission(context,p)==PackageManager.PERMISSION_GRANTED)"GRANTED" else "DENIED"
  return when(key){"accessibility.read"->if(ReadOnlyPageObserver.permissionGranted(context))"GRANTED" else "DENIED";"notification.read"->if(LazyArmorNotificationListener.status(context).optBoolean("accessGranted"))"GRANTED" else "DENIED";"appusage.read"->if(ForegroundPackageGuard.hasUsageAccess(context))"GRANTED" else "DENIED";"files.read"->"ON_DEMAND";"share.read","clipboard.read_on_demand","network.status","battery.status"->"GRANTED";else->"UNKNOWN"}
 }
 fun snapshot(context:Context,account:String):JSONObject {
  val now=System.currentTimeMillis();val states=JSONArray()
  for(key in keys){
   val health=when(key){
    "accessibility.read"->if(android.os.Build.VERSION.SDK_INT>=26 && BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY.isNotEmpty() && ReadOnlyPageObserver.connected(context))"HEALTHY" else "UNAVAILABLE"
    "voice.input"->if(SpeechRecognizer.isRecognitionAvailable(context))"HEALTHY" else "UNAVAILABLE"
    "calendar.read"->if(context.packageManager.resolveContentProvider(CalendarContract.AUTHORITY,0)!=null)"HEALTHY" else "UNAVAILABLE"
    "calendar.create","calendar.update","calendar.delete"->if(android.os.Build.VERSION.SDK_INT>=26 && BuildConfig.NATIVE_DISPATCH_PUBLIC_KEY.isNotEmpty() && context.packageManager.resolveContentProvider(CalendarContract.AUTHORITY,0)!=null)"HEALTHY" else "UNAVAILABLE"
    "contacts.read"->if(context.packageManager.resolveContentProvider(ContactsContract.AUTHORITY,0)!=null)"HEALTHY" else "UNAVAILABLE"
    "appusage.read","location.read","files.read"->"HEALTHY"
    "share.read"->if(context.packageManager.getActivityInfo(android.content.ComponentName(context,LazyArmorShareReceiverActivity::class.java),0).enabled)"HEALTHY" else "UNAVAILABLE"
    "clipboard.read_on_demand","battery.status","network.status"->"HEALTHY"
    "notification.read"->if(!LazyArmorNotificationListener.status(context).optBoolean("acquisitionEnabled"))"UNAVAILABLE" else if(LazyArmorNotificationListener.status(context).optBoolean("connected"))"HEALTHY" else "UNKNOWN"
    else->"UNAVAILABLE"
   }
   states.put(JSONObject().put("key",key).put("userGrant",granted(context,account,key)).put("systemPermission",permission(context,key)).put("health",health).put("checkedAt",now))
  }
  return JSONObject().put("manifestVersion","android-local-v5").put("capabilities",states)
 }
}
