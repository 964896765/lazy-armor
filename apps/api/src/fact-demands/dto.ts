import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import type { ScenarioGoalSpec, ScenarioResourceSubject } from '@lazy-armor/plan-schema';

export class ResolveFactDemandsDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsInt() @Min(1) scenarioRevision!: number;
  @IsObject() goal!: ScenarioGoalSpec;
  @IsObject() subject!: ScenarioResourceSubject;
}
