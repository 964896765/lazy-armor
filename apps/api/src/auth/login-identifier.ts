import { BadRequestException } from '@nestjs/common';

export type IdentifierKind = 'phone' | 'email';
export function normalizeIdentifier(kind: IdentifierKind, value: string): string {
  const trimmed = value.trim();
  if (kind === 'phone') {
    const phone = trimmed.replace(/^\+86/, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new BadRequestException('请输入有效的中国大陆手机号');
    return '+86' + phone;
  }
  if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new BadRequestException('请输入有效邮箱');
  return trimmed.toLowerCase();
}

export function maskIdentifier(kind: IdentifierKind, value: string) {
  return kind === 'phone' ? value.slice(0, 5) + '••••' + value.slice(-4) : value.slice(0, 1) + '•••@' + value.split('@')[1];
}
