import {describe,it,expect} from 'vitest';
import {parseShareText,suggestReferenceDomain} from '../src/share-text-parser';
describe('shared deterministic Share/Paste parser',()=>{
 it('suggests a domain separately and leaves unclear or mixed domains unset',()=>{
  expect(suggestReferenceDomain('100双中筒袜')).toBe('life');
  expect(suggestReferenceDomain('闲鱼运营指南爆款打法')).toBe('work');
  expect(suggestReferenceDomain('未知链接')).toBeNull();
  expect(suggestReferenceDomain('工作会议与家庭安排')).toBeNull();
 });
 it('preserves JD URL and raw evidence without confusing product and service',()=>{
  const rawText='【京东】ZH9112 https://3.cn/-35RF2ah?jkl=@O14TDDLy1L0I@ 【100双中筒袜】点击链接或者复制文案打开京东';
  expect(parseShareText({rawText})).toMatchObject({status:'READY',sourceUrl:'https://3.cn/-35RF2ah?jkl=@O14TDDLy1L0I@',sourcePlatform:'JD',shareCode:'ZH9112',titleCandidate:'100双中筒袜',kindCandidate:'PRODUCT',rawText});
 });
 it('parses the actual user-copied JD payload, including nested logistics marker',()=>{
  const rawText='【京东】https://3.cn/35RO-7uG?jkl=@W0a0c28PhTuD@ CA1565 「【京东物流】100双中筒袜」\r\n点击链接直接打开 或者复制文案打开京东';
  expect(parseShareText({rawText})).toMatchObject({sourceUrl:'https://3.cn/35RO-7uG?jkl=@W0a0c28PhTuD@',shareCode:'CA1565',titleCandidate:'100双中筒袜',sourcePlatform:'JD',kindCandidate:'PRODUCT',rawText});
 });
 it('fails closed for multiple URLs, credentials and no URL',()=>{
  expect(parseShareText({rawText:'https://a.cn/x https://b.cn/y'})).toMatchObject({status:'AMBIGUOUS',sourceUrl:null});
  expect(parseShareText({rawText:'https://user:pass@a.cn/x javascript:alert(1)'})).toMatchObject({status:'NO_URL',sourceUrl:null});
  expect(parseShareText({rawText:'100双中筒袜'})).toMatchObject({status:'NO_URL',sourceUrl:null,kindCandidate:'OTHER'});
 });
 it('uses the same rules for HTML without executing markup',()=>{
  expect(parseShareText({rawText:'<a href="https://3.cn/x?a=1&amp;b=2">【100双中筒袜】</a>',mimeType:'text/html'})).toMatchObject({sourceUrl:'https://3.cn/x?a=1&b=2',kindCandidate:'PRODUCT'});
 });
});
