import { IsBoolean, IsInt, IsUUID, Min } from 'class-validator';

export class ConfirmGoalPageReadDto {
  @IsInt() @Min(0) version!: number;
  @IsUUID() connectionId!: string;
  @IsBoolean() confirmed!: boolean;
}
