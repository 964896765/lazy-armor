import { IsBoolean, IsIn, IsInt, IsISO8601, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';

const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class CreateMobileNotificationReceiptDto {
  @IsString() @Matches(SHA256_HEX)
  eventId!: string;

  /** Non-reversible, device-generated digest of notification text. Raw title/body are never accepted. */
  @IsString() @Matches(SHA256_HEX)
  contentHash!: string;

  @IsString() @Matches(ANDROID_PACKAGE_NAME)
  sourcePackage!: string;

  @IsISO8601()
  postedAt!: string;

  @IsISO8601()
  capturedAt!: string;

  @IsBoolean()
  hasTitle!: boolean;

  @IsBoolean()
  hasText!: boolean;

  @IsIn(['unknown', 'billing_transaction_candidate', 'account_notification_candidate'])
  candidateKind!: 'unknown' | 'billing_transaction_candidate' | 'account_notification_candidate';

  @ValidateIf((value: CreateMobileNotificationReceiptDto) => value.candidateKind !== 'unknown')
  @IsIn(['mobile.billing.transaction', 'mobile.account.notification'])
  candidateResource!: 'mobile.billing.transaction' | 'mobile.account.notification' | null;

  @IsInt() @Min(0) @Max(100)
  candidateConfidence!: number;

  @ValidateIf((value: CreateMobileNotificationReceiptDto) => value.amountMinor !== null)
  @IsInt() @Min(0) @Max(2_147_483_647)
  amountMinor!: number | null;

  @ValidateIf((value: CreateMobileNotificationReceiptDto) => value.currency !== null)
  @IsIn(['CNY'])
  currency!: 'CNY' | null;

  @IsIn(['generic-notification-v1'])
  parserVersion!: 'generic-notification-v1';
}
