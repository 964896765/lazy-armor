import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PLAN_STRATEGIES, type StrategyKey } from '@lazy-armor/plan-schema';

export class BindStrategyRuntimeDto {
  @IsUUID() planVersionId!: string;
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsOptional() @IsString() @IsIn(PLAN_STRATEGIES.map((item) => item.key)) strategy?: StrategyKey;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}

export class DependencyQueryDto {
  @IsOptional() @IsString() @Length(1, 180) factKey?: string;
  @IsOptional() @IsString() @Length(1, 120) resourceType?: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}
