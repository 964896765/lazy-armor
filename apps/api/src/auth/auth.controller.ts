import { LoginCodeService } from './login-code.service';
import { EmailBindingService } from './email-binding.service';
import { PhoneBindingService } from './phone-binding.service';
import { PhoneChangeService } from './phone-change.service';
import { StartPhoneChangeDto } from './dto';
import { StartPhoneBindingDto, PhoneBindingChallengeDto, ConfirmPhoneBindingDto } from './dto';
import { StartEmailBindingDto, EmailBindingChallengeDto, ConfirmEmailBindingDto } from './dto';
import { RequestLoginCodeDto, VerifyLoginCodeDto, AccountEmailDto, VerifyAccountEmailRequestDto, VerifyAccountEmailDto, SetPasswordDto } from './dto';
import { Body, Controller, Get, Headers, Ip, Post } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, LogoutDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService,private readonly codes:LoginCodeService, private readonly emailBinding: EmailBindingService, private readonly phoneBinding: PhoneBindingService, private readonly phoneChange: PhoneChangeService) {}
  @Public() @Get('methods') loginMethods() {
    return { ...this.auth.loginMethods(), codeLogin: { phone: this.codes.availability('phone'), email: this.codes.availability('email') } };
  }
  @Public() @Post(['code/request','code/send']) requestCode(@Body() input:RequestLoginCodeDto,@Ip() ip:string){return this.codes.request(input,ip);}
  @Public() @Post('code/verify') async verifyCode(@Body() input:VerifyLoginCodeDto,@Ip() ip:string,@Headers('user-agent') userAgent?:string){const identifier=await this.codes.verify(input,ip);return this.auth.loginVerified(input.kind,identifier,{ip,userAgent});}

  @Get('security/methods') async securityMethods(@CurrentUser() user: AuthenticatedUser) { return { ...await this.auth.securityMethods(user.id), ...await this.emailBinding.capabilities(user), ...await this.phoneBinding.capabilities(user), ...await this.phoneChange.capabilities(user) }; }

  @Post('phone-change/start') startPhoneChange(@CurrentUser() user: AuthenticatedUser, @Body() input: StartPhoneChangeDto, @Ip() ip: string) { return this.phoneChange.start(user,input,ip); }
  @Post('phone-change/current/confirm') confirmPhoneChangeCurrent(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmPhoneBindingDto, @Ip() ip: string) { return this.phoneChange.confirmCurrent(user,input.challenge,input.code,ip); }
  @Post('phone-change/target/request') requestPhoneChangeTarget(@CurrentUser() user: AuthenticatedUser, @Body() input: PhoneBindingChallengeDto, @Ip() ip: string) { return this.phoneChange.requestTarget(user,input.challenge,ip); }
  @Post('phone-change/confirm') confirmPhoneChange(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmPhoneBindingDto, @Ip() ip: string) { return this.phoneChange.confirm(user,input.challenge,input.code,ip); }

  @Post('phone-binding/start') startPhoneBinding(@CurrentUser() user: AuthenticatedUser, @Body() input: StartPhoneBindingDto, @Ip() ip: string) { return this.phoneBinding.start(user, input, ip); }
  @Post('phone-binding/current/confirm') confirmPhoneCurrent(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmPhoneBindingDto, @Ip() ip: string) { return this.phoneBinding.confirmCurrent(user, input.challenge, input.code, ip); }
  @Post('phone-binding/target/request') requestPhoneTarget(@CurrentUser() user: AuthenticatedUser, @Body() input: PhoneBindingChallengeDto, @Ip() ip: string) { return this.phoneBinding.requestTarget(user, input.challenge, ip); }
  @Post('phone-binding/confirm') confirmPhoneBinding(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmPhoneBindingDto, @Ip() ip: string) { return this.phoneBinding.confirm(user, input.challenge, input.code, ip); }

  @Post('email-binding/start') startEmailBinding(@CurrentUser() user: AuthenticatedUser, @Body() input: StartEmailBindingDto, @Ip() ip: string) { return this.emailBinding.start(user, input, ip); }
  @Post('email-binding/current/confirm') confirmBindingCurrent(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmEmailBindingDto, @Ip() ip: string) { return this.emailBinding.confirmCurrent(user, input.challenge, input.code, ip); }
  @Post('email-binding/target/request') requestBindingTarget(@CurrentUser() user: AuthenticatedUser, @Body() input: EmailBindingChallengeDto, @Ip() ip: string) { return this.emailBinding.requestTarget(user, input.challenge, ip); }
  @Post('email-binding/confirm') confirmEmailBinding(@CurrentUser() user: AuthenticatedUser, @Body() input: ConfirmEmailBindingDto, @Ip() ip: string) { return this.emailBinding.confirm(user, input.challenge, input.code, ip); }

  @Post('identifiers/bind/request') async requestEmailProof(@CurrentUser() user: AuthenticatedUser, @Body() input: VerifyAccountEmailRequestDto, @Ip() ip: string) {
    await this.auth.assertEmailVerification(user.id, input.email, input.password);
    return this.codes.request({kind:'email',identifier:input.email}, ip, {purpose:'email-bind',userId:user.id});
  }
  @Post('identifiers/bind/confirm') async confirmEmailProof(@CurrentUser() user: AuthenticatedUser, @Body() input: VerifyAccountEmailDto, @Ip() ip: string) {
    const proof = await this.auth.assertEmailVerification(user.id, input.email, input.password);
    await this.codes.verify({kind:'email',identifier:input.email,code:input.code}, ip, {purpose:'email-bind',userId:user.id});
    return this.auth.verifyLegacyEmail(user.id, input.email, proof.passwordHash);
  }
  @Post('password/set/request') async requestPasswordProof(@CurrentUser() user: AuthenticatedUser, @Body() input: AccountEmailDto, @Ip() ip: string) {
    await this.auth.assertInitialPassword(user.id,input.email);
    return this.codes.request({kind:'email',identifier:input.email}, ip, {purpose:'password-set',userId:user.id});
  }
  @Post('password/set') async setPassword(@CurrentUser() user: AuthenticatedUser, @Body() input: SetPasswordDto, @Ip() ip: string) {
    await this.auth.assertInitialPassword(user.id,input.email);
    await this.codes.verify({kind:'email',identifier:input.email,code:input.code}, ip, {purpose:'password-set',userId:user.id});
    return this.auth.setInitialPassword(user.id,input.email,input.newPassword);
  }


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
  forgotPassword(@Body() input: ForgotPasswordDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.forgotPassword(input.email, { ip, userAgent });
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() input: ResetPasswordDto, @Ip() ip: string) {
    return this.auth.resetPassword(input, {ip});
  }
}
