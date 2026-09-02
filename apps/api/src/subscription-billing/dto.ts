import { IsIn, IsString, Length } from 'class-validator';

export class CreateSubscriptionCheckoutDto {
  @IsIn(['plus']) planKey!: 'plus';
  @IsString() @Length(1, 255) requestId!: string;
}

export class CancelSubscriptionDto {
  @IsString() @Length(1, 255) requestId!: string;
}
