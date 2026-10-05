import {SERVICE_DOMAINS} from '@lazy-armor/plan-schema';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
export class ServiceFulfillmentDto {
 @IsOptional() @IsIn([...SERVICE_DOMAINS.map(row=>row.value),'other']) domain?: string;
 @IsOptional() @IsString() @Length(1,40) serviceType?: string;
 @IsOptional() @IsIn(['LOCAL','ONSITE','AT_LOCATION','REMOTE','LOGISTICS','OTHER']) deliveryMode?: string;
 @IsOptional() @IsIn(['FIXED','STARTING_FROM','NEGOTIABLE','FREE']) priceMode?: string;
 @IsOptional() @IsString() @MaxLength(300) serviceArea?: string;
 @IsOptional() @IsString() @MaxLength(600) serviceAddress?: string;
 @IsOptional() @IsString() @MaxLength(600) locationInstructions?: string;
 @IsOptional() @IsString() @MaxLength(600) remoteInstructions?: string;
 @IsOptional() @IsString() @MaxLength(600) shippingInstructions?: string;
 @IsOptional() @IsString() @MaxLength(600) shippingFeeRules?: string;
 @IsOptional() @IsString() @MaxLength(600) deliveryInstructions?: string;
 @IsOptional() @IsString() @MaxLength(600) bookingInstructions?: string;
 @IsOptional() @IsInt() @Min(0) @Max(100000000) priceMinor?: number;
}
export class PublishServiceDto extends ServiceFulfillmentDto {
 @IsString() @Length(1, 100) requestId!: string;
 @IsString() @Length(1, 160) title!: string;
 @IsString() @Length(1, 600) summary!: string;
 @IsString() @Length(1, 160) contact!: string;
 @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
 @IsOptional() @IsUUID() imageMediaId?: string;
 @IsBoolean() confirmed!: boolean;
 @IsOptional() @IsIn(['PUBLISHED', 'DRAFT']) status?: 'PUBLISHED' | 'DRAFT';
}
export class ServiceMediaDto { @IsString() @Length(1, 100) requestId!: string; @IsString() @Length(1, 10666668) contentBase64!: string; }
export class UpdateServiceOfferingDto extends ServiceFulfillmentDto {
 @IsString() @Length(1, 40) expectedUpdatedAt!: string;
 @IsString() @Length(1, 160) title!: string;
 @IsString() @Length(1, 600) summary!: string;
 @IsString() @Length(1, 160) contact!: string;
 @IsIn(['PUBLISHED', 'DRAFT', 'UNPUBLISHED']) status!: string;
 @IsBoolean() confirmed!: boolean;
}

