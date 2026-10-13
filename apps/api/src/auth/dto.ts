import { IsIn, IsUUID, Matches, IsEmail, IsString, Length, MaxLength, MinLength, ValidateBy, ValidateIf, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

// bcrypt only covers the first 72 bytes. Retain legacy login compatibility,
// but never accept a new password whose suffix would silently be ignored.
const BcryptPasswordLength = () => ValidateBy({ name: 'bcryptPasswordLength', validator: {
 validate: value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
 defaultMessage: () => '密码过长，请控制在 72 个 UTF-8 字节以内。',
} });

export class RegisterDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(10, 128)
  @BcryptPasswordLength()
  password!: string;

  @IsString()
  @Length(1, 120)
  displayName!: string;
}

export class LoginDto {
  @ValidateIf(input=>input.identifier===undefined||input.email!==undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional() @IsIn(['email','phone']) kind?: 'email'|'phone';
  @ValidateIf(input=>input.identifier!==undefined)
  @IsString() @Length(3,320) identifier?: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @Length(32, 512)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @Length(32, 512)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  oldPassword!: string;

  @IsString()
  @Length(10, 128)
  @BcryptPasswordLength()
  newPassword!: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  @MaxLength(1024)
  token!: string;

  @IsString()
  @Length(10, 128)
  @BcryptPasswordLength()
  newPassword!: string;
}

export class RequestLoginCodeDto {
 @IsIn(['phone','email']) kind!: 'phone' | 'email';
 @IsString() @Length(3,320) identifier!: string;
}
export class VerifyLoginCodeDto extends RequestLoginCodeDto {
 @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class AccountEmailDto {
 @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
 @IsEmail() @MaxLength(320) email!: string;
}
export class VerifyAccountEmailRequestDto extends AccountEmailDto {
 @IsString() @Length(1,128) password!: string;
}
export class VerifyAccountEmailDto extends VerifyAccountEmailRequestDto {
 @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class SetPasswordDto extends AccountEmailDto {
 @IsString() @Matches(/^\d{6}$/) code!: string;
 @IsString() @Length(10,128) @BcryptPasswordLength() newPassword!: string;
}

export class StartEmailBindingDto extends AccountEmailDto {
 @IsIn(['password','code']) proof!: 'password'|'code';
 @IsOptional() @IsString() @Length(1,128) password?: string;
 @IsOptional() @IsUUID() identifierId?: string;
}
export class EmailBindingChallengeDto {
 @IsString() @Matches(/^[a-f0-9]{64}$/) challenge!: string;
}
export class ConfirmEmailBindingDto extends EmailBindingChallengeDto {
 @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class StartPhoneBindingDto {
 @IsString() @Length(11,32) phone!: string;
 @IsIn(['password','code']) proof!: 'password'|'code';
 @IsOptional() @IsString() @Length(1,128) password?: string;
 @IsOptional() @IsUUID() identifierId?: string;
}
export class PhoneBindingChallengeDto extends EmailBindingChallengeDto {}
export class ConfirmPhoneBindingDto extends PhoneBindingChallengeDto {
 @IsString() @Matches(/^\d{6}$/) code!: string;
}
