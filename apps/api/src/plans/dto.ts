import { IsArray, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AUTOMATION_LEVELS, PLAN_DOMAINS, PLAN_STATES, type PlanDefinitionInput, type PlanState } from '@lazy-armor/plan-schema';

export class PlanDefinitionDto implements PlanDefinitionInput {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsString() @IsIn(PLAN_DOMAINS) domain!: PlanDefinitionInput['domain'];
  @IsString() @IsIn(AUTOMATION_LEVELS) automationLevel!: PlanDefinitionInput['automationLevel'];
  @IsOptional() @IsObject() approvalPolicy?: PlanDefinitionInput['approvalPolicy'];
  @IsArray() sources!: PlanDefinitionInput['sources'];
  @IsArray() triggers!: PlanDefinitionInput['triggers'];
  @IsArray() conditions!: PlanDefinitionInput['conditions'];
  @IsArray() actions!: PlanDefinitionInput['actions'];
}

export class ChangePlanStatusDto {
  @IsString() @IsIn(PLAN_STATES) status!: PlanState;
}

export class TemplateConfigDto {
  @IsOptional() @IsObject()
  config?: Record<string, unknown>;
}
