import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CursorPageDto } from '../common/cursor-pagination';
import { MEMORY_RELATIONS, MEMORY_TYPES, type MemoryRelationType, type MemoryType } from '@lazy-armor/plan-schema';

export class MemorySettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) version!: number;
}
export class MemoryContentDto {
  @IsIn(MEMORY_TYPES) type!: MemoryType;
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MinLength(1) @MaxLength(1000) content!: string;
  @IsBoolean() confirmed!: boolean;
  @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string | null;
}
export class CreateMemoryDto extends MemoryContentDto { @IsString() @MinLength(1) @MaxLength(160) requestId!: string }
export class EditMemoryDto extends MemoryContentDto { @IsInt() @Min(1) version!: number }
export class DeleteMemoryDto { @IsInt() @Min(1) version!: number }
export class ConfirmMemoryCandidateDto extends EditMemoryDto {}
export class ListMemoryCandidatesDto extends CursorPageDto { @IsUUID() conversationId!: string }
export class MemoryReferenceDto { @Type(() => Number) @IsInt() @Min(1) version!: number }
export class CreateMemoryRelationDto {
  @IsString() @MinLength(1) @MaxLength(160) requestId!: string;
  @IsInt() @Min(1) fromVersion!: number;
  @IsUUID() toId!: string;
  @IsInt() @Min(1) toVersion!: number;
  @IsIn(MEMORY_RELATIONS) relation!: MemoryRelationType;
  @IsBoolean() confirmed!: boolean;
}
