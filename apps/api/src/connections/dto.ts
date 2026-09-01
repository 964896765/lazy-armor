import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsISO8601, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

export class CreateConnectionDto {
  @IsString() @Length(1, 80) connectorId!: string;
  @IsString() @Length(1, 255) externalAccountName!: string;
  @IsOptional() @IsObject() credentials?: Record<string, string>;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class StartOAuthConnectionDto {
  @IsString() @Length(1, 500)
  redirectUri!: string;
}

export class CompleteOAuthConnectionDto {
  @IsString() @Length(1, 255)
  state!: string;

  @IsString() @Length(1, 500)
  code!: string;

  @IsString() @Length(1, 500)
  redirectUri!: string;
}

export class RotateConnectionCredentialsDto {
  @IsObject() credentials!: Record<string, string>;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class PermissionUpdateDto {
  @IsString() @Length(1, 100) capability!: string;
  @IsBoolean() granted!: boolean;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class UpdatePermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionUpdateDto)
  permissions!: PermissionUpdateDto[];
}

export class WebhookEventDto {
  @IsString() @Length(1, 255) eventId!: string;
  @IsString() @Length(1, 255) requestId!: string;
  @IsString() @Length(1, 255) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(32) timestamp?: string;
  @IsOptional() @IsString() @MaxLength(128) signature?: string;
  @IsObject() payload!: Record<string, unknown>;
}

export class InvokeConnectorDto {
  @IsString() @Length(1, 100) capability!: string;
  @IsString() @Length(1, 255) requestId!: string;
  @IsOptional() @IsString() @MaxLength(255) idempotencyKey?: string;
  @IsObject() input!: Record<string, unknown>;
}
