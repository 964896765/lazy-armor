/** Isolated offline document extractor. No application credentials or runtime privileges. */
import { createHash } from 'node:crypto';
import * as mammoth from 'mammoth';
async function main() {
 let raw = ''; for await (const chunk of process.stdin) { raw += chunk.toString(); if (raw.length > 2_900_000) throw new Error('INPUT_LIMIT'); }
 const input = JSON.parse(raw) as { mimeType: string; contentBase64: string };
 const bytes = Buffer.from(input.contentBase64, 'base64'); let text = ''; let pages: number | null = null;
 if (input.mimeType === 'application/pdf') {
  const module = await (new Function('specifier', 'return import(specifier)')('pdfjs-dist/legacy/build/pdf.mjs') as Promise<typeof import('pdfjs-dist')>);
  const loading = module.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const document = await loading.promise; pages = document.numPages;
  if (pages > 100) throw new Error('PAGE_LIMIT');
  for (let n = 1; n <= pages && text.length < 64000; n++) { const page = await document.getPage(n); const content = await page.getTextContent(); text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n'; page.cleanup(); }
  await document.destroy();
 } else if (input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  text = (await mammoth.extractRawText({ buffer: bytes })).value;
 } else throw new Error('UNSUPPORTED_DOCUMENT');
 if (!text.trim()) throw new Error('NO_EXTRACTABLE_TEXT');
 const truncated = text.length > 48000; text = text.slice(0, 48000);
 process.stdout.write(JSON.stringify({ text, contentSha256: createHash('sha256').update(text).digest('hex'), metadata: { pages, truncated, provenance: 'USER_DOCUMENT_UNVERIFIED', ocr: false } }));
}
main().catch(() => { process.stdout.write(JSON.stringify({ error: 'DOCUMENT_EXTRACTION_FAILED' })); process.exitCode = 1; });
