import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { UsersService } from './users.service';

class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(1024) avatar?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(32) locale?: string;
}

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() getMe(@CurrentUser() user: AuthenticatedUser) { return this.users.getMe(user.id); }
  @Patch('profile') update(@CurrentUser() user: AuthenticatedUser, @Body() input: UpdateProfileDto) { return this.users.updateProfile(user.id, input); }
}
