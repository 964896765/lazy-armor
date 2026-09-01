import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class TemplateInstallDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class NaturalLanguageTemplateDto {
  @IsString()
  @Length(1, 500)
  query!: string;
}
