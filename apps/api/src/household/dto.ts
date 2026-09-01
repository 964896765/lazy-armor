import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateHouseholdSupplyProfileDto {
  @IsString() @Length(1, 120) itemName!: string;
  @IsString() @Length(1, 120) category!: string;
  @IsDateString() lastPurchasedAt!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) quantity!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) estimatedUsageDays!: number;
  @IsString() @IsIn(['manual', 'internal', 'test']) sourceType!: 'manual' | 'internal' | 'test';
}

export class ListHouseholdSupplyProfilesDto {
  @IsOptional() @IsString() @Length(1, 120) itemName?: string;
}

export class ListPreparedShoppingItemsDto {
  @IsOptional() @IsString() @IsIn(['prepared', 'completed', 'dismissed']) status?: 'prepared' | 'completed' | 'dismissed';
}
