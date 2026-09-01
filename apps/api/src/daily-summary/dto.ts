import { IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const IMPORTANT_ITEM_SOURCE_TYPES = ['internal_task', 'manual_event', 'test_email', 'test_calendar', 'email', 'calendar'] as const;
export type ImportantItemSourceType = typeof IMPORTANT_ITEM_SOURCE_TYPES[number];

export class CreateImportantItemCandidateDto {
  @IsString() @IsIn(IMPORTANT_ITEM_SOURCE_TYPES)
  sourceType!: ImportantItemSourceType;

  @IsString() @Length(1, 255)
  sourceId!: string;

  @IsString() @Length(1, 160)
  title!: string;

  @IsString() @MaxLength(1000)
  summary!: string;

  @IsDateString()
  occurredAt!: string;

  @IsOptional() @IsDateString()
  dueAt?: string;

  @IsOptional() @IsString() @Length(1, 255)
  senderOrOrganizer?: string;

  @IsString() @Length(1, 120)
  category!: string;

  @IsOptional() @IsObject()
  importanceSignals?: Record<string, unknown>;

  @IsOptional() @IsBoolean()
  requiresAction?: boolean;
}

export class ListImportantItemCandidatesDto {
  @IsOptional() @IsString() @IsIn(IMPORTANT_ITEM_SOURCE_TYPES)
  sourceType?: ImportantItemSourceType;
}

export class SyncImportantItemSourceDto {
  @IsString() @Length(1, 80)
  connectionId!: string;

  @IsString() @IsIn(['email', 'calendar'])
  sourceType!: 'email' | 'calendar';

  @IsOptional() @IsObject()
  input?: Record<string, unknown>;
}
