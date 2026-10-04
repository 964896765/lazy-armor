import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
export class PublishServiceDto {
 @IsString() @Length(1, 100) requestId!: string;
 @IsString() @Length(1, 160) title!: string;
 @IsString() @Length(1, 600) summary!: string;
 @IsIn(['life', 'family', 'travel', 'health', 'work', 'other']) domain!: string;
 @IsIn(['LOCAL', 'REMOTE']) deliveryMode!: 'LOCAL' | 'REMOTE';
 @IsString() @Length(1, 300) serviceArea!: string;
 @IsString() @Length(1, 160) contact!: string;
 @IsOptional() @IsInt() @Min(0) @Max(100000000) priceMinor?: number;
 @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
 @IsOptional() @IsUUID() imageMediaId?: string;
 @IsBoolean() confirmed!: boolean;
}
export class ServiceMediaDto { @IsString() @Length(1, 100) requestId!: string; @IsString() @Length(1, 10666668) contentBase64!: string; }
