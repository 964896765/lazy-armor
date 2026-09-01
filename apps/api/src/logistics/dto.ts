import { IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';

export const LOGISTICS_STATUSES = ['created', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'unknown'] as const;
export type LogisticsStatus = typeof LOGISTICS_STATUSES[number];

export class CreateLogisticsTrackingSnapshotDto {
  @IsString() @Length(1, 120) trackingNumber!: string;
  @IsString() @Length(1, 60) carrier!: string;
  @IsString() @IsIn(LOGISTICS_STATUSES) status!: LogisticsStatus;
  @IsOptional() @IsString() @Length(1, 255) latestEvent?: string;
  @IsOptional() @IsDateString() latestEventAt?: string;
  @IsDateString() lastUpdatedAt!: string;
  @IsOptional() @IsDateString() deliveredAt?: string;
  @IsString() @IsIn(['manual', 'internal', 'test']) sourceType!: 'manual' | 'internal' | 'test';
}

export class ListLogisticsTrackingSnapshotsDto {
  @IsOptional() @IsString() @Length(1, 120) trackingNumber?: string;
}
