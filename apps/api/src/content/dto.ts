import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export const CONTENT_PLATFORMS = ['douyin', 'bilibili'] as const;
export type ContentPlatform = typeof CONTENT_PLATFORMS[number];

export class CreateMasterContentDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 2048, { each: true }) mediaReferences?: string[];
  @IsOptional() @IsString() @Length(1, 1024) coverReference?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true }) tags?: string[];
  @IsString() @IsIn(['manual', 'internal', 'test']) sourceType!: 'manual' | 'internal' | 'test';
}

export class ListPlatformVariantsDto {
  @IsOptional() @IsUUID()
  masterContentId?: string;

  @IsOptional() @IsString() @IsIn(CONTENT_PLATFORMS)
  platform?: ContentPlatform;
}
