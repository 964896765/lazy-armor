import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class SetCostBudgetDto {
  @IsIn(['user', 'provider']) scopeType!: 'user' | 'provider';
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @Length(1, 80) provider?: string;
  @IsInt() @Min(0) monthlyLimitMinor!: number;
  @IsString() @Length(3, 8) currency!: string;
}
