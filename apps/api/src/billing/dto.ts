import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateBillingRecordDto {
  @IsString() @Length(1, 120) provider!: string;
  @IsString() @Length(1, 120) category!: string;
  @IsString() @Length(7, 20) billingPeriod!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100000000) amount!: number;
  @IsString() @Length(3, 3) currency!: string;
  @IsDateString() occurredAt!: string;
  @IsString() @IsIn(['manual', 'internal']) sourceType!: 'manual' | 'internal';
}

export class ListBillingRecordsDto {
  @IsOptional() @IsString() @Length(7, 20) billingPeriod?: string;
}
