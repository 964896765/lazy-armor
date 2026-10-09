import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsString, ValidateNested } from 'class-validator';
import { LOCAL_CAPABILITY_CATALOG } from '@lazy-armor/plan-schema';
class NativeCapabilityStateDto {
 @IsIn(LOCAL_CAPABILITY_CATALOG.map(row=>row.key)) key!:string;
 @IsBoolean() userGrant!:boolean;
 @IsIn(['GRANTED','DENIED','ON_DEMAND','UNKNOWN']) systemPermission!:string;
 @IsIn(['HEALTHY','UNAVAILABLE','UNKNOWN']) health!:string;
 @IsNumber() checkedAt!:number;
}
export class NativeCapabilitiesDto {
 @IsIn(['android-local-v2','android-local-v3','android-local-v4','android-local-v5']) manifestVersion!:string;
 @IsArray() @ArrayMaxSize(32) @ValidateNested({each:true}) @Type(()=>NativeCapabilityStateDto) capabilities!:NativeCapabilityStateDto[];
}
