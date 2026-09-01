import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GetStudyProgressDto {
  @IsUUID()
  planId!: string;
}

export class UpdateStudyProgressDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  currentProgressPercent?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  completedTaskIds?: string[];
}

export class ListStudyTasksDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsDateString()
  studyDate?: string;
}
