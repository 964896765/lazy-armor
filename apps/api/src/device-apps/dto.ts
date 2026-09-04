import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateDeviceAppConnectionDto {
  @IsString() @Length(1, 128)
  deviceId!: string;

  @IsString() @Length(1, 255)
  packageName!: string;

  @IsArray()
  @IsIn(['open_app', 'deep_link', 'notification_read'], { each: true })
  modes!: string[];
}

export class UpdateDeviceAppConnectionDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsArray()
  @IsIn(['open_app', 'deep_link', 'notification_read'], { each: true })
  modes?: string[];
}
