import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOperationalRecordDto {
  @IsIn(['order', 'inventory', 'refund', 'supply']) recordType!: 'order' | 'inventory' | 'refund' | 'supply';
  @IsString() @Length(1, 160) subject!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) quantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(20_000_000) amount?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsString() @Length(1, 32) status!: string;
  @IsDateString() occurredAt!: string;
  @IsBoolean() needsAttention!: boolean;
  @IsIn(['manual', 'internal', 'file']) sourceType!: 'manual' | 'internal' | 'file';
}
