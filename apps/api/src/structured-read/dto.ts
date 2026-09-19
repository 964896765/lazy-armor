import { ArrayNotEmpty, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { STRUCTURED_READ_SOURCES, type FieldExpectation, type StructuredReadSource } from '@lazy-armor/plan-schema';

export class StructuredReadRequestDto {
  @IsString() @MaxLength(64) requestId!: string;
  @IsIn(STRUCTURED_READ_SOURCES) sourceType!: StructuredReadSource;
  @IsString() @MaxLength(120) resourceType!: string;
  @IsString() @MaxLength(255) resourceId!: string;
  @IsOptional() @IsString() @MaxLength(80) providerKey?: string | null;
  @IsOptional() @IsUUID() connectionId?: string | null;
  @IsOptional() @IsString() @MaxLength(128) deviceId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) packageName?: string | null;
  @IsOptional() @IsUUID() appReadSessionId?: string | null;
  @IsOptional() @IsObject() pageRange?: { from: number; to: number } | null;
  @IsOptional() @IsString() @MaxLength(255) structuredSelector?: string | null;
  @IsOptional() @IsString() @MaxLength(120) resourceHint?: string | null;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) requestedFields!: string[];
  @IsOptional() @IsObject() fieldExpectations?: Record<string, FieldExpectation>;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  @IsOptional() @IsString() @MaxLength(120) mimeType?: string;
}
