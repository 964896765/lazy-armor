import { IsArray, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import type { ScenarioGoalSpec, ScenarioResourceSubject } from '@lazy-armor/plan-schema';

export class SaveCreationDraftDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsInt() @Min(1) scenarioRevision!: number;
  @IsInt() @Min(1) stage!: number;
  @IsObject() goal!: ScenarioGoalSpec;
  @IsOptional() @IsObject() subject?: ScenarioResourceSubject | null;
  @IsOptional() @IsArray() sourceChoices?: unknown[];
  @IsOptional() @IsString() @Length(1, 160) selectedOfferKey?: string | null;
  @IsOptional() @IsInt() @Min(0) version?: number;
}
