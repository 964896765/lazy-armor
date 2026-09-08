import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PLAN_STRATEGIES, type StrategyKey } from '@lazy-armor/plan-schema';

export class CompileScenarioDto {
  @IsOptional() @IsString() @IsIn(PLAN_STRATEGIES.map((item) => item.key)) strategy?: StrategyKey;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
}
