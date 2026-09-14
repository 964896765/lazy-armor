import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PLAN_STRATEGIES, type StrategyKey } from '@lazy-armor/plan-schema';

export class CompileScenarioDto {
  @IsOptional() @IsInt() @Min(1) scenarioRevision?: number;
  @IsOptional() @IsString() @IsIn(PLAN_STRATEGIES.map((item) => item.key)) strategy?: StrategyKey;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}
