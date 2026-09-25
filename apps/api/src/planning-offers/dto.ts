import { IsOptional, IsString, Length } from 'class-validator';

export class CreatePlanOfferDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsString() @Length(1, 500) goal!: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}
