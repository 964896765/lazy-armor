import { Type, Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, Length, Matches, ValidateBy, ValidateNested, ArrayMaxSize, IsArray } from 'class-validator';
import { EmailBindingChallengeDto } from './dto';

const Base64Url = (max: number) => ValidateBy({name:'boundedBase64Url',validator:{validate:value=>typeof value==='string'&&value.length>=1&&value.length<=max&&/^[A-Za-z0-9_-]+$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value}});
export class StartPasskeyDto {
  @IsIn(['register','revoke']) operation!: 'register'|'revoke';
  @IsIn(['password','code']) proof!: 'password'|'code';
  @IsOptional() @IsString() @Length(1,128) password?: string;
  @IsOptional() @IsUUID() identifierId?: string;
  @IsOptional() @IsUUID() credentialId?: string;
  @IsOptional() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,60) label?: string;
}
class RegistrationDataDto {
  @Base64Url(4096) clientDataJSON!: string;
  @Base64Url(16384) attestationObject!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsIn(['ble','cable','hybrid','internal','nfc','smart-card','usb'],{each:true}) transports?: Array<'ble'|'cable'|'hybrid'|'internal'|'nfc'|'smart-card'|'usb'>;
  @IsOptional() @Base64Url(4096) authenticatorData?: string;
  @IsOptional() @Base64Url(4096) publicKey?: string;
  @IsOptional() @IsIn([-7,-257,-8]) publicKeyAlgorithm?: number;
}
class AuthenticationDataDto {
  @Base64Url(4096) clientDataJSON!: string;
  @Base64Url(4096) authenticatorData!: string;
  @Base64Url(2048) signature!: string;
  @IsOptional() @Base64Url(128) userHandle?: string;
}
class CredentialDto {
  @Base64Url(1400) id!: string;
  @Base64Url(1400) rawId!: string;
  @IsIn(['public-key']) type!: 'public-key';
  @IsOptional() @IsIn(['platform','cross-platform']) authenticatorAttachment?: 'platform'|'cross-platform';
  @IsObject() @ValidateBy({name:'boundedExtensions',validator:{validate:value=>value&&JSON.stringify(value).length<=4096}}) clientExtensionResults!: Record<string,unknown>;
}
class RegistrationCredentialDto extends CredentialDto {
  @IsObject() @ValidateNested() @Type(()=>RegistrationDataDto) response!: RegistrationDataDto;
}
class AuthenticationCredentialDto extends CredentialDto {
  @IsObject() @ValidateNested() @Type(()=>AuthenticationDataDto) response!: AuthenticationDataDto;
}
export class RegisterPasskeyDto extends EmailBindingChallengeDto {
  @IsObject() @ValidateNested() @Type(()=>RegistrationCredentialDto) credential!: RegistrationCredentialDto;
}
export class LoginPasskeyDto extends EmailBindingChallengeDto {
  @IsObject() @ValidateNested() @Type(()=>AuthenticationCredentialDto) credential!: AuthenticationCredentialDto;
}
