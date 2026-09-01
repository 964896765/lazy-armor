import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Public()
  @Post('login')
  login(@Body() input: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(input, { ip, userAgent });
  }

  @Public()
  @Post('refresh')
  refresh(@Body() input: RefreshDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(input.refreshToken, { ip, userAgent });
  }

  @Public()
  @Post('logout')
  logout(@Body() input: LogoutDto) {
    return this.auth.logout(input.refreshToken);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() input: ChangePasswordDto) {
    return this.auth.changePassword(user.id, input);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() input: ForgotPasswordDto) {
    return this.auth.forgotPassword(input.email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.auth.resetPassword(input);
  }
}
