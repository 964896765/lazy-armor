import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { EXECUTION_STATES, type ExecutionStatus } from './execution.types';

export class ManualExecutionDto {
  @IsString() @Length(1, 255) requestId!: string;
  @IsObject() triggerPayload!: Record<string, unknown>;
}

export class ListExecutionsDto {
  @IsOptional() @IsIn(EXECUTION_STATES) status?: ExecutionStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
