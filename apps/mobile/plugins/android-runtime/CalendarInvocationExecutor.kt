package com.lazyarmor.app

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.security.MessageDigest
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID

/** Internal executor, deliberately not exposed as an arbitrary React Native write method.
 * The approved DeviceTask adapter must supply a canonical Invocation and current authority.
 * PREPARED is durably committed before the OS call. Recovery is read-only, even if no event
 * can be found: a crash in the insert/receipt gap must never authorize a second insert.
 */
internal object CalendarInvocationExecutor {
  private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  @Synchronized
  fun execute(context: Context, account: String, invocation: JSONObject,
              currentTargetId: String, currentEpoch: Long, approvalInvocationId: String,
              lookupOnly: Boolean = false): JSONObject {
    require(android.os.Build.VERSION.SDK_INT >= 26) { "PLATFORM_UNSUPPORTED" }
    require(invocation.keys().asSequence().toSet() == setOf("invocationId", "planId", "planVersionId", "executionId",
      "capabilityId", "targetId", "arguments", "resourceScope", "authorityEpoch", "timeoutMs", "idempotencyKey",
      "resolutionDecisionRef", "riskSnapshotRef", "approvalRef", "verificationContractRef", "createdAt")) { "INVALID_INVOCATION_FIELDS" }
    require(LocalCapabilityManifest.activeAccount(context) == account) { "ACCOUNT_CHANGED" }
    val capability = invocation.getString("capabilityId")
    require(capability in listOf("calendar.event.create", "calendar.event.update", "calendar.event.delete")) { "CAPABILITY_MISMATCH" }
    val invocationId = invocation.getString("invocationId")
    require(UUID.fromString(invocationId).toString() == invocationId) { "INVALID_INVOCATION" }
    require(invocation.getString("targetId") == currentTargetId && invocation.getLong("authorityEpoch") == currentEpoch) { "STALE_AUTHORITY" }
    require(approvalInvocationId == invocationId && !invocation.isNull("riskSnapshotRef")
      && !invocation.isNull("executionId")) { "APPROVAL_REQUIRED" }
    require(LocalCapabilityManifest.granted(context, account, "calendar." + capability.substringAfterLast('.'))) { "USER_GRANT_REQUIRED" }
    for (permission in listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)) {
      require(ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) { "PERMISSION_REQUIRED" }
    }
    val key = invocation.getString("idempotencyKey")
    require(key.isNotBlank() && key.length <= 255) { "INVALID_OPERATION_KEY" }
    if (capability != "calendar.event.create") return mutate(context, account, invocation, currentTargetId, currentEpoch, lookupOnly)
    val arguments = invocation.getJSONObject("arguments")
    val event = arguments.getJSONObject("actionConfig").getJSONObject("calendarEvent")
    val allowed = setOf("calendarId", "title", "start", "end", "attendees", "sendUpdates")
    require(event.keys().asSequence().toSet() == allowed) { "INVALID_EVENT_FIELDS" }
    val calendarText = event.getString("calendarId")
    require(calendarText.matches(Regex("[1-9][0-9]*"))) { "INVALID_CALENDAR" }
    val calendarId = calendarText.toLong()
    require(calendarId <= 9007199254740991L) { "INVALID_CALENDAR" }
    require(event.getJSONArray("attendees").length() == 0 && event.getString("sendUpdates") == "none") { "INVITATIONS_UNSUPPORTED" }
    val title = event.getString("title")
    require(title.isNotEmpty() && title.length <= 512) { "INVALID_TITLE" }
    fun endpoint(name: String): Pair<Long, String> {
      val value = event.getJSONObject(name)
      require(value.keys().asSequence().toSet() == setOf("dateTime", "timeZone")) { "INVALID_TIME_FIELDS" }
      val zone = value.getString("timeZone")
      ZoneId.of(zone)
      return Pair(OffsetDateTime.parse(value.getString("dateTime")).toInstant().toEpochMilli(), zone)
    }
    val start = endpoint("start"); val end = endpoint("end")
    require(end.first > start.first) { "INVALID_INTERVAL" }
    val operationId = hash("$account:$currentTargetId:$key")
    val marker = "lazyarmor-operation:$operationId"
    // Bind all immutable bytes, including epoch. Never overwrite an earlier operation.
    val fingerprint = hash(canonical(invocation))
    val store = context.getSharedPreferences("lazy_armor_calendar_operations_${hash(account)}", Context.MODE_PRIVATE)
    val previous = store.getString(operationId, null)?.let { JSONObject(it) }
    if (previous != null) require(previous.getString("invocationHash") == fingerprint) { "OPERATION_IDENTITY_CONFLICT" }
    // Transport replay returns the original retained receipt, not another OS read.
    // Explicit reconciliation remains lookup-only and can obtain fresh evidence.
    val retained = previous?.optJSONObject("result")
    if (!lookupOnly && retained?.optString("state") == "SUCCEEDED") {
      val checked = JSONObject(retained.toString())
      val expectedHash = checked.remove("resultHash")
      require(expectedHash is String && hash(canonical(checked)) == expectedHash) { "RESULT_INTEGRITY_ERROR" }
      return retained
    }

    fun unknown(reason: String): JSONObject {
      val result = JSONObject().put("invocationId", invocationId)
        .put("targetId", currentTargetId).put("authorityEpoch", currentEpoch)
        .put("operationId", operationId).put("state", "OUTCOME_UNKNOWN").put("reason", reason)
      return result.put("resultHash", hash(canonical(result)))
    }
    fun readback(): JSONObject? {
      val projection = arrayOf(CalendarContract.Events._ID, CalendarContract.Events.CALENDAR_ID,
        CalendarContract.Events.TITLE, CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND,
        CalendarContract.Events.EVENT_TIMEZONE, CalendarContract.Events.EVENT_END_TIMEZONE,
        CalendarContract.Events.DESCRIPTION, CalendarContract.Events.DELETED, CalendarContract.Events.ALL_DAY)
      val cursor = context.contentResolver.query(CalendarContract.Events.CONTENT_URI, projection,
        "${CalendarContract.Events.CALENDAR_ID}=? AND ${CalendarContract.Events.DESCRIPTION}=?",
        arrayOf(calendarText, marker), null) ?: throw IllegalStateException("READBACK_UNAVAILABLE")
      cursor.use {
        if (!it.moveToFirst()) return null
        val evidence = JSONObject().put("eventId", it.getLong(0).toString()).put("calendarId", it.getLong(1).toString())
          .put("title", it.getString(2)).put("startAt", it.getLong(3)).put("endAt", it.getLong(4))
          .put("timeZone", it.getString(5)).put("endTimeZone", it.getString(6))
          .put("operationMarker", it.getString(7)).put("deleted", it.getInt(8)).put("allDay", it.getInt(9))
        val matched = evidence.getString("calendarId") == calendarText && evidence.getString("title") == title
          && evidence.getLong("startAt") == start.first && evidence.getLong("endAt") == end.first
          && evidence.getString("timeZone") == start.second && evidence.getString("endTimeZone") == end.second
          && evidence.getInt("deleted") == 0 && evidence.getInt("allDay") == 0 && !it.moveToNext()
        val result = JSONObject().put("invocationId", invocationId).put("targetId", currentTargetId)
          .put("authorityEpoch", currentEpoch).put("operationId", operationId)
          .put("deviceOperationId", evidence.getString("eventId"))
          .put("state", if (matched) "SUCCEEDED" else "OUTCOME_UNKNOWN")
          .put("evidence", evidence).put("matched", matched)
        result.put("resultHash", hash(canonical(result)))
        return result
      }
    }
    // Replays always query the operation marker. A missing/deleted event is uncertainty.
    if (previous != null || lookupOnly) return try { readback() ?: unknown("OPERATION_NOT_FOUND") }
      catch (_: Exception) { unknown("READBACK_UNAVAILABLE") }

    val calendar = context.contentResolver.query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, calendarId),
      arrayOf(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL), null, null, null)
      ?: throw IllegalStateException("CALENDAR_UNAVAILABLE")
    calendar.use { require(it.moveToFirst() && it.getInt(0) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) { "CALENDAR_NOT_WRITABLE" } }
    val prepared = JSONObject().put("invocationHash", fingerprint).put("state", "PREPARED").put("invocationId", invocationId)
    check(store.edit().putString(operationId, prepared.toString()).commit()) { "OPERATION_STORAGE_UNAVAILABLE" }
    try {
      val values = ContentValues().apply {
        put(CalendarContract.Events.CALENDAR_ID, calendarId); put(CalendarContract.Events.TITLE, title)
        put(CalendarContract.Events.DTSTART, start.first); put(CalendarContract.Events.DTEND, end.first)
        put(CalendarContract.Events.EVENT_TIMEZONE, start.second); put(CalendarContract.Events.EVENT_END_TIMEZONE, end.second)
        put(CalendarContract.Events.DESCRIPTION, marker); put(CalendarContract.Events.ALL_DAY, 0)
      }
      val uri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
      if (uri != null) {
        prepared.put("deviceOperationId", ContentUris.parseId(uri).toString())
        check(store.edit().putString(operationId, prepared.toString()).commit()) { "OPERATION_STORAGE_UNAVAILABLE" }
      }
      val result = readback() ?: unknown("OPERATION_NOT_FOUND")
      prepared.put("result", result)
      check(store.edit().putString(operationId, prepared.toString()).commit()) { "RESULT_STORAGE_UNAVAILABLE" }
      return result
    } catch (_: Exception) {
      // Never infer no effect from an insert exception; recovery may only read.
      return try { readback() ?: unknown("INSERT_OUTCOME_UNKNOWN") } catch (_: Exception) { unknown("READBACK_UNAVAILABLE") }
    }
  }

  /** Same approved Invocation, journal and lookup-only recovery; never reapply a PREPARED mutation. */
  private fun mutate(context: Context, account: String, invocation: JSONObject, targetId: String, epoch: Long, lookupOnly: Boolean): JSONObject {
    val delete = invocation.getString("capabilityId") == "calendar.event.delete"
    val event = invocation.getJSONObject("arguments").getJSONObject("actionConfig").getJSONObject("calendarMutation")
    val identityFields = setOf("calendarId", "eventId", "expectedOperationMarker")
    require(event.keys().asSequence().toSet() == if (delete) identityFields else identityFields + setOf("title", "start", "end", "attendees", "sendUpdates")) { "INVALID_MUTATION_FIELDS" }
    val calendarId = event.getString("calendarId"); val eventId = event.getString("eventId")
    for (id in listOf(calendarId, eventId)) require(id.matches(Regex("[1-9][0-9]*")) && id.toLong() <= 9007199254740991L) { "INVALID_EXTERNAL_IDENTITY" }
    val expected = event.getString("expectedOperationMarker")
    require(expected.matches(Regex("lazyarmor-operation:[a-f0-9]{64}"))) { "INVALID_OPERATION_MARKER" }
    var start = 0L; var end = 0L; var zone = ""; var endZone = ""; var title = ""
    if (!delete) {
      require(event.getJSONArray("attendees").length() == 0 && event.getString("sendUpdates") == "none") { "INVITATIONS_UNSUPPORTED" }
      title = event.getString("title"); require(title.isNotEmpty() && title.length <= 512) { "INVALID_TITLE" }
      fun instant(name: String): Pair<Long, String> {
        val value = event.getJSONObject(name)
        require(value.keys().asSequence().toSet() == setOf("dateTime", "timeZone")) { "INVALID_TIME_FIELDS" }
        val timezone = value.getString("timeZone"); ZoneId.of(timezone)
        return Pair(OffsetDateTime.parse(value.getString("dateTime")).toInstant().toEpochMilli(), timezone)
      }
      val from = instant("start"); val to = instant("end")
      start = from.first; zone = from.second; end = to.first; endZone = to.second
      require(end > start) { "INVALID_INTERVAL" }
    }
    val invocationId = invocation.getString("invocationId")
    val operationId = hash("$account:$targetId:${invocation.getString("idempotencyKey")}")
    val marker = "lazyarmor-operation:$operationId"
    val store = context.getSharedPreferences("lazy_armor_calendar_operations_${hash(account)}", Context.MODE_PRIVATE)
    val fingerprint = hash(canonical(invocation))
    val previous = store.getString(operationId, null)?.let { JSONObject(it) }
    if (previous != null) require(previous.getString("invocationHash") == fingerprint) { "OPERATION_IDENTITY_CONFLICT" }
    previous?.optJSONObject("result")?.let {
      if (!lookupOnly && it.optString("state") == "SUCCEEDED") {
        val bytes = JSONObject(it.toString()); val saved = bytes.remove("resultHash")
        require(saved is String && hash(canonical(bytes)) == saved) { "RESULT_INTEGRITY_ERROR" }
        return it
      }
    }
    fun result(matched: Boolean, evidence: JSONObject?, reason: String = "MUTATION_OUTCOME_UNKNOWN"): JSONObject {
      val receipt = JSONObject().put("invocationId", invocationId).put("targetId", targetId).put("authorityEpoch", epoch)
        .put("operationId", operationId).put("deviceOperationId", eventId).put("state", if (matched) "SUCCEEDED" else "OUTCOME_UNKNOWN")
        .put("matched", matched).put("reason", reason)
      if (evidence != null) receipt.put("evidence", evidence)
      return receipt.put("resultHash", hash(canonical(receipt)))
    }
    fun read(): JSONObject? {
      val projection = arrayOf(CalendarContract.Events._ID, CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE,
        CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND, CalendarContract.Events.EVENT_TIMEZONE,
        CalendarContract.Events.EVENT_END_TIMEZONE, CalendarContract.Events.DESCRIPTION, CalendarContract.Events.DELETED, CalendarContract.Events.ALL_DAY)
      val cursor = context.contentResolver.query(CalendarContract.Events.CONTENT_URI, projection,
        "${CalendarContract.Events._ID}=? AND ${CalendarContract.Events.CALENDAR_ID}=?", arrayOf(eventId, calendarId), null)
        ?: throw IllegalStateException("READBACK_UNAVAILABLE")
      cursor.use {
        if (!it.moveToFirst()) return null
        val value = JSONObject().put("eventId", it.getLong(0).toString()).put("calendarId", it.getLong(1).toString())
          .put("title", it.getString(2)).put("startAt", it.getLong(3)).put("endAt", it.getLong(4))
          .put("timeZone", it.getString(5)).put("endTimeZone", it.getString(6)).put("operationMarker", it.getString(7))
          .put("deleted", it.getInt(8)).put("allDay", it.getInt(9))
        require(!it.moveToNext()) { "EXTERNAL_IDENTITY_CONFLICT" }
        return value
      }
    }
    fun lookup(prepared: JSONObject?): JSONObject {
      val reality = read()
      if (delete) {
        // Absence alone cannot prove an authorized delete: require the durable pre-call observation.
        val absent = reality == null || reality.optInt("deleted") == 1
        val observed = prepared?.optBoolean("observedBeforeMutation") == true && prepared.optString("expectedOperationMarker") == expected
        val evidence = JSONObject().put("eventId", eventId).put("calendarId", calendarId).put("expectedOperationMarker", expected)
          .put("absent", absent).put("observedBeforeMutation", observed)
        return result(absent && observed, evidence)
      }
      val matched = reality != null && reality.optString("operationMarker") == marker && reality.optString("title") == title
        && reality.optLong("startAt") == start && reality.optLong("endAt") == end && reality.optString("timeZone") == zone
        && reality.optString("endTimeZone") == endZone && reality.optInt("deleted") == 0 && reality.optInt("allDay") == 0
      return result(matched, reality)
    }
    if (previous != null || lookupOnly) return try { lookup(previous) } catch (_: Exception) { result(false, null, "READBACK_UNAVAILABLE") }
    val before = read()
    require(before != null && before.optInt("deleted") == 0 && before.optString("operationMarker") == expected) { "EXTERNAL_IDENTITY_CHANGED" }
    val prepared = JSONObject().put("invocationHash", fingerprint).put("invocationId", invocationId).put("state", "PREPARED")
      .put("deviceOperationId", eventId).put("expectedOperationMarker", expected).put("observedBeforeMutation", true)
    check(store.edit().putString(operationId, prepared.toString()).commit()) { "OPERATION_STORAGE_UNAVAILABLE" }
    val selection = "${CalendarContract.Events._ID}=? AND ${CalendarContract.Events.CALENDAR_ID}=? AND ${CalendarContract.Events.DESCRIPTION}=?"
    try {
      if (delete) context.contentResolver.delete(CalendarContract.Events.CONTENT_URI, selection, arrayOf(eventId, calendarId, expected))
      else {
        val values = ContentValues().apply {
          put(CalendarContract.Events.TITLE, title); put(CalendarContract.Events.DTSTART, start); put(CalendarContract.Events.DTEND, end)
          put(CalendarContract.Events.EVENT_TIMEZONE, zone); put(CalendarContract.Events.EVENT_END_TIMEZONE, endZone)
          put(CalendarContract.Events.DESCRIPTION, marker)
        }
        context.contentResolver.update(CalendarContract.Events.CONTENT_URI, values, selection, arrayOf(eventId, calendarId, expected))
      }
      val receipt = lookup(prepared)
      prepared.put("result", receipt)
      check(store.edit().putString(operationId, prepared.toString()).commit()) { "RESULT_STORAGE_UNAVAILABLE" }
      return receipt
    } catch (_: Exception) {
      return try { lookup(prepared) } catch (_: Exception) { result(false, null, "READBACK_UNAVAILABLE") }
    }
  }

  private fun canonical(value: Any?): String = when (value) {
    null, JSONObject.NULL -> "null"
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { quote(it) + ":" + canonical(value.get(it)) }
    is org.json.JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
    is String -> quote(value)
    else -> value.toString()
  }
  // Match JSON.stringify: Android org.json may escape '/' differently.
  private fun quote(value:String):String {
    val out=StringBuilder("\"");var i=0
    while(i<value.length){val c=value[i]
      when(c){
        '"'->out.append("\\\"");'\\'->out.append("\\\\");'\b'->out.append("\\b")
        '\u000c'->out.append("\\f");'\n'->out.append("\\n");'\r'->out.append("\\r");'\t'->out.append("\\t")
        else->if(c.code<32||(Character.isSurrogate(c)&&!(Character.isHighSurrogate(c)&&i+1<value.length&&Character.isLowSurrogate(value[i+1]))))out.append("\\u%04x".format(c.code))
          else {out.append(c);if(Character.isHighSurrogate(c)){i++;out.append(value[i])}}
      };i++
    }
    return out.append('"').toString()
  }
}
