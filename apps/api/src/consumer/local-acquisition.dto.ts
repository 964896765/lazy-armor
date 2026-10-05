import {IsIn,IsString,Length,IsInt,Min,IsOptional,IsArray,ArrayMaxSize,IsNumber,IsBoolean,Matches} from 'class-validator';
export class LocalAcquisitionDto {
 @IsIn(['android-local-v1','android-artifact-v1']) manifestVersion!:string;
 @IsIn(['notification.read','calendar.read','files.read','contacts.read','appusage.read','location.read','share.read','network.status','battery.status']) capability!:string;
 @IsIn(['VERIFIED_PRESENT','VERIFIED_EMPTY','STALE','UNAVAILABLE','PERMISSION_REQUIRED','OFFLINE','CONFLICT','UNKNOWN']) state!:string;
 @IsNumber() observedAt!:number;
 @IsNumber() scopeStart!:number;
 @IsNumber() scopeEnd!:number;
 @IsOptional() @IsInt() @Min(0) itemCount?:number;
 @IsOptional() @Matches(/^[a-f0-9]{64}$/) contentHash?:string;
 @IsOptional() @IsArray() @ArrayMaxSize(500) items?:Record<string,unknown>[];
 @IsOptional() @IsString() @Length(1,500) reason?:string;
 @IsOptional() @IsString() @Length(2,200000) contentJson?:string;
 @IsOptional() @IsBoolean() truncated?:boolean;
}
