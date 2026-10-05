import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeTextAttachment } from '../consumer/attachment-policy';
const DOCUMENT_MIMES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
@Injectable()
export class ArtifactExtractorService {
 async extract(fileName: string, mimeType: string, contentBase64: string) {
  if(['image/png','image/jpeg','image/webp'].includes(mimeType)){
   const bytes=Buffer.from(contentBase64,'base64');
   const valid=mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   if(!valid)throw new BadRequestException('图片内容与类型不一致');
   let image:{width?:number;height?:number};try{image=await sharp(bytes,{limitInputPixels:40000000}).metadata();if(!image.width||!image.height)throw new Error('invalid');}catch{throw new BadRequestException('图片已损坏或超过像素限制');}
   return {text:'',contentSha256:createHash('sha256').update('').digest('hex'),extractorKey:'image-retained@1',metadata:{provenance:'USER_DOCUMENT_UNVERIFIED',ocr:false,width:image.width,height:image.height,extractionPending:true,reason:'OCR_VISION_EVIDENCE_PENDING'}};
  }
  if(mimeType==='text/html'){const text=Buffer.from(contentBase64,'base64').toString('utf8');return {text,contentSha256:createHash('sha256').update(text).digest('hex'),extractorKey:'html-raw@1',metadata:{provenance:'USER_DOCUMENT_UNVERIFIED',ocr:false}};}
  if (!DOCUMENT_MIMES.includes(mimeType)) { const decoded = decodeTextAttachment(fileName, mimeType, contentBase64, 2_000_000); return { text: decoded.content.slice(0,48000), contentSha256: createHash('sha256').update(decoded.content.slice(0,48000)).digest('hex'), extractorKey: 'utf8-text@1', metadata: { truncated: decoded.content.length > 48000, provenance: 'USER_DOCUMENT_UNVERIFIED', ocr: false } }; }
  const bytes = Buffer.from(contentBase64, 'base64');
  if (mimeType === 'application/pdf' ? !/\.pdf$/i.test(fileName) || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) : !/\.docx$/i.test(fileName) || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) throw new BadRequestException('文件内容与类型不一致');
  const direct = resolve(__dirname, 'extractor.worker.js'); const worker = existsSync(direct) ? direct : resolve(process.cwd(), 'dist/artifacts/extractor.worker.js');
  if (!existsSync(worker)) throw new BadRequestException('文档提取服务尚未部署');
  return new Promise<{ text: string; contentSha256: string; extractorKey: string; metadata: Record<string, unknown> }>((accept, reject) => {
   const child = spawn(process.execPath, ['--max-old-space-size=128', worker], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP } });
   let output = ''; let settled = false;
   const fail = () => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(new BadRequestException('无法提取文档文字：请使用未加密、含文本的 PDF 或 DOCX')); };
   const timer = setTimeout(fail, 15000);
   child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 400000) fail(); }); child.stderr.resume();
   child.on('error', fail); child.stdin.on('error', fail);
   child.on('close', code => { if (settled) return; if (code !== 0) return fail(); try { const data = JSON.parse(output); if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 48000 || !/^[a-f0-9]{64}$/.test(data.contentSha256)) return fail(); settled = true; clearTimeout(timer); accept({ ...data, extractorKey: mimeType === 'application/pdf' ? 'pdf-text@1' : 'docx-text@1' }); } catch { fail(); } });
   child.stdin.end(JSON.stringify({ mimeType, contentBase64 }));
  });
 }
}
