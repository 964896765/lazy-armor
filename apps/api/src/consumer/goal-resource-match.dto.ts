import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
export class GoalResourceMatchQueryDto { @Type(() => Number) @IsInt() @Min(0) version!: number }
