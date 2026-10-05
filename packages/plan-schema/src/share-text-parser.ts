/** Deterministic lexical evidence only. No network resolution or AI inference. */
export const EXTERNAL_REFERENCE_KINDS = ['SERVICE','PRODUCT','PLACE','CONTENT','OTHER','DOCUMENT','EVENT'] as const;
export type ExternalReferenceKind = typeof EXTERNAL_REFERENCE_KINDS[number];
export const EXTERNAL_REFERENCE_DOMAINS = ['life','family','travel','health','work','other'] as const;
export type ExternalReferenceDomain = typeof EXTERNAL_REFERENCE_DOMAINS[number];
/** Optional filing suggestion from literal words, never a source fact. */
export function suggestReferenceDomain(text:string):ExternalReferenceDomain|null {
 const matches:ExternalReferenceDomain[]=[];
 for(const [domain,rule] of [['life',/袜|日用品|餐饮|外卖/],['family',/家庭|家政|育儿/],['travel',/车票|机票|酒店|出行/],['health',/医疗|挂号|体检/],['work',/工作|办公|会议|运营指南/]] as const)if(rule.test(text))matches.push(domain);
 return matches.length===1?matches[0]:null;
}
export interface RawSharePayload { rawText:string; mimeType?:'text/plain'|'text/html'; subject?:string; }
export interface ShareReceipt { receiptId:string; acquisitionMode:'SHARE'|'PASTE'; payload:RawSharePayload; receivedAt:string; evidenceRefs:readonly string[]; }
export function parseShareReceipt(receipt:ShareReceipt):ExternalReferenceDraft {return parseShareText(receipt.payload);}
export interface ExternalReferenceDraft {
 status:'READY'|'AMBIGUOUS'|'NO_URL'; sourceUrl:string|null; urls:string[];
 sourcePlatform:string|null; titleCandidate:string|null; shareCode:string|null;
 kindCandidate:ExternalReferenceKind; rawText:string; parserVersion:string; ruleId:string;
}
export const SHARE_PARSER_VERSION='share-text-v1';
export function parseShareText(payload:RawSharePayload):ExternalReferenceDraft {
 const rawText=payload.rawText;
 if(rawText.length>12000)throw new Error('SHARE_PAYLOAD_TOO_LARGE');
 const markup=rawText.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 const text=payload.mimeType==='text/html'?markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/&nbsp;/gi,' '):rawText;
 const urlText=payload.mimeType==='text/html'?text+' '+[...markup.matchAll(/\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/gi,'&')).join(' '):text;
 const urls=[...new Set([...urlText.matchAll(/https?:\/\/[^\s<>"'\u3000-\u303f\u4e00-\u9fff]+/gi)].map(m=>m[0].replace(/[.,;!，。；！)\]】]+$/g,'')).filter(value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!!u.hostname;}catch{return false;}}))];
 const sourceUrl=urls.length===1?urls[0]:null;
 const host=sourceUrl?new URL(sourceUrl).hostname.toLowerCase():null;
 const jd=host!==null&&(host==='3.cn'||host==='jd.com'||host.endsWith('.jd.com'));
 const titleText=text.replace(/【(?:京东(?:物流)?|JD|淘宝|拼多多|分享|口令)】/gi,'');
 const title=[...titleText.matchAll(/[【「《]([^\n【】「」《》]{1,160})[】」》]/g)].map(m=>m[1].trim()).find(t=>! /^(京东|JD|淘宝|拼多多|分享|口令)$/i.test(t));
 const shareCode=jd?(text.match(/\b[A-Z]{2}\d{4,12}\b/)?.[0]??null):null;
 return {status:urls.length===1?'READY':urls.length>1?'AMBIGUOUS':'NO_URL',sourceUrl,urls,sourcePlatform:jd?'JD':host,titleCandidate:title??payload.subject?.trim().slice(0,160)??null,shareCode,kindCandidate:jd?'PRODUCT':'OTHER',rawText,parserVersion:SHARE_PARSER_VERSION,ruleId:jd?'jd-shortlink-v1':urls.length>1?'multiple-urls-v1':urls.length===1?'single-http-url-v1':'no-url-v1'};
}
