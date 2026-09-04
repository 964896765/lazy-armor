import { IsBoolean } from 'class-validator';

export class VerifyMobileNotificationReceiptDto {
  /** User confirms whether the already-stored candidate may become a brand-neutral verified fact. */
  @IsBoolean()
  confirmed!: boolean;
}
