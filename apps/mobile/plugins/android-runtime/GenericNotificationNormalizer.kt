package com.lazyarmor.app

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Provider-neutral, deterministic in-memory notification normalization.
 * It deliberately has no package-name rules. Its output is a candidate only:
 * server-side verification is required before any domain fact or plan input exists.
 */
data class NormalizedNotificationCandidate(
  val kind: String,
  val resource: String?,
  val confidence: Int,
  val amountMinor: Long?,
  val currency: String?,
  val parserVersion: String,
  val status: String?,
)

object GenericNotificationNormalizer {
  private const val VERSION = "generic-notification-v1"
  private val moneyPattern = Regex("(?:¥|￥|CNY\\s*)([0-9]{1,9}(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE)
  private val transactionTerms = Regex("扣款|付款|支付|消费|充值|缴费|收款|到账|退款|转账")
  private val accountTerms = Regex("登录|验证码|安全|验证|密码|账号")
  private val shipmentTerms = Regex("快递|包裹|物流|派送|配送|签收|到件|已发货|运输|揽收|转运")
  private val billTerms = Regex("账单|欠费|待缴|水电|燃气|宽带|物业|话费")
  private val deviceTerms = Regex("耗材|滤芯|墨盒|硒鼓|保养|电量不足|剩余用量")
  private val deliveredTerms = Regex("到件|签收|已送达|已投递|已签收")
  private val exceptionTerms = Regex("异常|延误|退回|派送失败")

  fun normalize(title: String, body: String): NormalizedNotificationCandidate {
    val text = "$title\n$body".replace(Regex("\\s+"), " ").trim()
    if (text.isBlank()) return unknown()
    val amountMinor = parseAmountMinor(text)
    return when {
      amountMinor != null && transactionTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "billing_transaction_candidate", resource = "mobile.billing.transaction", confidence = 70,
        amountMinor = amountMinor, currency = "CNY", parserVersion = VERSION, status = null,
      )
      shipmentTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "shipment_candidate", resource = "shipment", confidence = 75,
        amountMinor = null, currency = null, parserVersion = VERSION, status = shipmentStatus(text),
      )
      billTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "bill_candidate", resource = "Bill", confidence = 70,
        amountMinor = null, currency = null, parserVersion = VERSION, status = "DUE",
      )
      deviceTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "device_candidate", resource = "DeviceStatus", confidence = 70,
        amountMinor = null, currency = null, parserVersion = VERSION, status = "LOW",
      )
      accountTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "account_notification_candidate", resource = "mobile.account.notification", confidence = 55,
        amountMinor = null, currency = null, parserVersion = VERSION, status = null,
      )
      else -> unknown()
    }
  }

  private fun unknown() = NormalizedNotificationCandidate("unknown", null, 0, null, null, VERSION, null)

  private fun shipmentStatus(text: String): String = when {
    exceptionTerms.containsMatchIn(text) -> "EXCEPTION"
    deliveredTerms.containsMatchIn(text) -> "DELIVERED"
    else -> "IN_TRANSIT"
  }

  private fun parseAmountMinor(text: String): Long? {
    val raw = moneyPattern.find(text)?.groupValues?.getOrNull(1) ?: return null
    return try {
      BigDecimal(raw).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact().takeIf { it in 0..2_147_483_647L }
    } catch (_: Exception) { null }
  }
}
