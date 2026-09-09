import { IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PARSER_KEYS, SOURCE_MODES, type SourceObservationInput } from '@lazy-armor/plan-schema';

export class CreateSourceObservationDto implements SourceObservationInput {
  @IsIn(SOURCE_MODES) sourceMode!: SourceObservationInput['sourceMode'];
  @IsString() @MaxLength(80) providerKey!: string;
  @IsOptional() @IsUUID() connectionId?: string | null;
  @IsString() @MaxLength(255) externalEventKey!: string;
  @IsIn(PARSER_KEYS) parserKey!: SourceObservationInput['parserKey'];
  @IsString() @MaxLength(120) resourceHint!: string;
  @IsObject() payload!: SourceObservationInput['payload'];
  @IsString() @Matches(/^[a-f0-9]{64}$/) evidenceHash!: string;
  @IsISO8601() observedAt!: string;
  @IsOptional() @IsISO8601() occurredAt?: string | null;
}
