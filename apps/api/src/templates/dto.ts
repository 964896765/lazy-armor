import { IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class TemplateInstallDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class NaturalLanguageTemplateDto {
  @IsString()
  @Length(1, 500)
  query!: string;
  @IsOptional()
  @IsString()
  @MaxLength(255)
  requestId?: string;
}

export class TemplateLifecycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
