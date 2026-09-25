import { IsOptional, IsString, Length } from 'class-validator';
import type { ScenarioGoalSpec, ScenarioResourceSubject } from '@lazy-armor/plan-schema';
import { IsInt, IsObject, Min } from 'class-validator';

export class CreatePlanOfferDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsString() @Length(1, 500) goal!: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}

export class CreatePersistentPlanOfferDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsInt() @Min(1) scenarioRevision!: number;
  @IsObject() goal!: ScenarioGoalSpec;
  @IsObject() subject!: ScenarioResourceSubject;
}

export class ChoosePersistentPlanOfferDto {
  @IsString() @Length(8, 120) idempotencyKey!: string;
}
