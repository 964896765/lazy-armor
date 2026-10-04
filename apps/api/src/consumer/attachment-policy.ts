import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export function decodeTextAttachment(fileName: string, mimeType: string, contentBase64: string, maxBytes = 48_000) {
  if (!/\.(txt|md|csv|json)$/i.test(fileName) || !['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(mimeType)) {
    throw new BadRequestException('目前支持 UTF-8 的 TXT、Markdown、CSV 和 JSON 文件');
  }
  if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw new BadRequestException('文件编码无效');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw new BadRequestException(`文本附件需在 1 字节至 ${maxBytes} 字节之间`);
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new BadRequestException('请上传 UTF-8 编码的文本文件'); }
  if (!content.trim() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content)) throw new BadRequestException('文件没有可读取的文本或包含二进制内容');
  return { content, sizeBytes: bytes.length, contentSha256: createHash('sha256').update(bytes).digest('hex') };
}
