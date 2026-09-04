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
)

object GenericNotificationNormalizer {
  private const val VERSION = "generic-notification-v1"
  private val moneyPattern = Regex("(?:¥|￥|CNY\\s*)([0-9]{1,9}(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE)
  private val transactionTerms = Regex("扣款|付款|支付|消费|充值|缴费|收款|到账|退款|转账")
  private val accountTerms = Regex("登录|验证码|安全|验证|设备|密码|账号")

  fun normalize(title: String, body: String): NormalizedNotificationCandidate {
    val text = "$title\n$body".replace(Regex("\\s+"), " ").trim()
    if (text.isBlank()) return unknown()
    val amountMinor = parseAmountMinor(text)
    return when {
      amountMinor != null && transactionTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "billing_transaction_candidate", resource = "mobile.billing.transaction", confidence = 70,
        amountMinor = amountMinor, currency = "CNY", parserVersion = VERSION,
      )
      accountTerms.containsMatchIn(text) -> NormalizedNotificationCandidate(
        kind = "account_notification_candidate", resource = "mobile.account.notification", confidence = 55,
        amountMinor = null, currency = null, parserVersion = VERSION,
      )
      else -> unknown()
    }
  }

  private fun unknown() = NormalizedNotificationCandidate("unknown", null, 0, null, null, VERSION)

  private fun parseAmountMinor(text: String): Long? {
    val raw = moneyPattern.find(text)?.groupValues?.getOrNull(1) ?: return null
    return try {
      BigDecimal(raw).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact().takeIf { it in 0..2_147_483_647L }
    } catch (_: Exception) { null }
  }
}
