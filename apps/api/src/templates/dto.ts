import { IsObject, IsOptional } from 'class-validator';

export class TemplateInstallDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
