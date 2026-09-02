import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CursorPageDto {
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export interface StableCursor { createdAt: Date; id: string }

export function encodeCursor(value: StableCursor) {
  return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }), 'utf8').toString('base64url');
}

export function decodeCursor(value?: string): StableCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    const createdAt = new Date(String(parsed.createdAt));
    const id = String(parsed.id);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('invalid');
    return { createdAt, id };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}

export function pageResult<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
