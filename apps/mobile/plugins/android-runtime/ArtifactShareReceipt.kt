package com.lazyarmor.app
import android.content.Context
import java.util.UUID
/** Raw OS share receipts. Parsing belongs exclusively to the shared TS parser. */
object ArtifactShareReceipt {
 data class Receipt(val id:String,val account:String,val text:String,val receivedAt:Long,val bytes:ByteArray,val mimeType:String,val fileName:String,val children:List<String>)
 private val pending=linkedMapOf<String,Receipt>()
 @Synchronized fun capture(context:Context,text:String,mimeType:String="text/plain",bytes:ByteArray=text.toByteArray(Charsets.UTF_8),fileName:String="shared-payload.txt",children:List<String> = emptyList()):String? {
  val account=LocalCapabilityManifest.activeAccount(context)?:return null
  if(!LocalCapabilityManifest.granted(context,account,"share.read")||bytes.isEmpty()||bytes.size>2000000||text.length>12000)return null
  val receipt=Receipt(UUID.randomUUID().toString(),account,text,System.currentTimeMillis(),bytes,mimeType,fileName,children)
  pending.entries.removeAll {System.currentTimeMillis()-it.value.receivedAt>300000}
  if(pending.size>=12)pending.remove(pending.keys.first())
  pending[receipt.id]=receipt;return receipt.id
 }
 @Synchronized fun get(context:Context,account:String,id:String):Receipt? {
  val receipt=pending[id]?:return null
  if(receipt.account!=account||LocalCapabilityManifest.activeAccount(context)!=account||!LocalCapabilityManifest.granted(context,account,"share.read")||System.currentTimeMillis()-receipt.receivedAt>300000){pending.remove(id);return null}
  return receipt
 }
 @Synchronized fun attachChildren(id:String,children:List<String>){pending[id]?.let {pending[id]=it.copy(children=children)}}
 @Synchronized fun clear(){pending.clear()}
}
