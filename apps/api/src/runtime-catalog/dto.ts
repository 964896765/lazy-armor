import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PLAN_STRATEGIES, type StrategyKey, type TerminalHandoffTarget, type TerminalHandoffTargetKind } from '@lazy-armor/plan-schema';

export class TerminalHandoffTargetDto implements TerminalHandoffTarget {
  @IsIn(['NOTION_UPDATE', 'CALENDAR_EVENT']) kind!: TerminalHandoffTargetKind;
  @IsUUID() connectionId!: string;
  @IsObject() action!: Record<string, unknown>;
}

export class CompileScenarioDto {
  @IsOptional() @IsInt() @Min(1) scenarioRevision?: number;
  @IsOptional() @IsString() @IsIn(PLAN_STRATEGIES.map((item) => item.key)) strategy?: StrategyKey;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
  @IsOptional() @ValidateNested() @Type(() => TerminalHandoffTargetDto) target?: TerminalHandoffTargetDto;
}
