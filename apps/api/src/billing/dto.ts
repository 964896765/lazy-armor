import { Type } from 'class-transformer';
import { IsBase64, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateBillingRecordDto {
  @IsString() @Length(1, 120) provider!: string;
  @IsString() @Length(1, 120) category!: string;
  @IsString() @Length(7, 20) billingPeriod!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100000000) amount!: number;
  @IsString() @Length(3, 3) currency!: string;
  @IsDateString() occurredAt!: string;
  @IsString() @IsIn(['manual', 'internal', 'file']) sourceType!: 'manual' | 'internal' | 'file';
}

export class ImportBillingFileDto {
  @IsString() @Length(1, 255) @Matches(/^[^\\/]+$/) fileName!: string;
  @IsString() @IsIn(['text/csv', 'application/json']) mimeType!: 'text/csv' | 'application/json';
  @IsString() @IsBase64() @MaxLength(1_500_000) contentBase64!: string;
  @IsString() @Length(1, 255) idempotencyKey!: string;
}

export class ListBillingRecordsDto {
  @IsOptional() @IsString() @Length(7, 20) billingPeriod?: string;
}
