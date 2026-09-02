import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { UsersService } from './users.service';

class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(1024) avatar?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(32) locale?: string;
}

class UpdateNotificationSettingsDto {
  @IsOptional() @IsBoolean() importantExceptionImmediately?: boolean;
  @IsOptional() @IsBoolean() regularSummary?: boolean;
  @IsOptional() @IsBoolean() silentSuccess?: boolean;
  @IsOptional() @IsString() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) dailySummaryTime?: string;
}

class UpdateAutomationSafetyDto {
  @IsOptional() @IsString() @IsIn(['notify_only', 'prepare_only', 'confirm_before_execute', 'high_risk_extra_confirmation']) preferredMode?: string;
  @IsOptional() @IsBoolean() requireExtraConfirmationForHighRisk?: boolean;
}

class UpdateSettingsDto {
  @IsOptional() @ValidateNested() @Type(() => UpdateNotificationSettingsDto) notifications?: UpdateNotificationSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => UpdateAutomationSafetyDto) automationSafety?: UpdateAutomationSafetyDto;
}

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() getMe(@CurrentUser() user: AuthenticatedUser) { return this.users.getMe(user.id); }
  @Patch('profile') update(@CurrentUser() user: AuthenticatedUser, @Body() input: UpdateProfileDto) { return this.users.updateProfile(user.id, input); }
  @Get('settings') getSettings(@CurrentUser() user: AuthenticatedUser) { return this.users.getSettings(user.id); }
  @Patch('settings') updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() input: UpdateSettingsDto) { return this.users.updateSettings(user.id, input); }
}
