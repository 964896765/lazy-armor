import sharp from 'sharp';
import type {INestApplication} from '@nestjs/common';
import type {Pool} from 'mysql2/promise';
import request from 'supertest';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {auth,bootP2App,register,type Session} from './p2-test-helpers';
describe.sequential('Share/Paste existing reference and evidence chain',{timeout:90000},()=>{
 let app:INestApplication,pool:Pool,owner:Session,other:Session;
 const rawText='【京东】https://3.cn/35RO-7uG?jkl=@W0a0c28PhTuD@ CA1565 「【京东物流】100双中筒袜」\r\n点击链接直接打开 或者复制文案打开京东';
 const body={title:'100双中筒袜',summary:'',sourceUrl:'https://3.cn/35RO-7uG?jkl=@W0a0c28PhTuD@',sourcePlatform:'spoofed',kind:'PRODUCT',category:'其他',importMethod:'MANUAL',rawText};
 beforeAll(async()=>{const b=await bootP2App(`share-${Date.now()}`);app=b.app;pool=b.pool;owner=await register(app,`share-owner-${Date.now()}@example.com`,'Owner');other=await register(app,`share-other-${Date.now()}@example.com`,'Other');});
 afterAll(async()=>{await app?.close();await pool?.end();});
 it('stores only the lexical URL, keeps immutable evidence, excludes products from services and creates pending candidates',async()=>{
  const r=await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send(body).expect(201);
  expect(r.body).toMatchObject({kind:'PRODUCT',sourceUrl:body.sourceUrl,sourcePlatform:'JD',shareCode:'CA1565',rawText,parserVersion:'share-text-v1',availability:'NOT_VERIFIED'});
  expect(r.body.evidenceArtifactId).toBeTruthy();
  const services=await request(app.getHttpServer()).get('/api/external-services').set(auth(owner.token)).expect(200);expect(services.body.some((s:{id:string})=>s.id===r.body.id)).toBe(false);
  await request(app.getHttpServer()).get('/api/external-references/'+r.body.id).set(auth(other.token)).expect(404);
  const [rows]=await pool.query("select status,truth_record_id from candidate_facts where resource_type='ExternalReference' and resource_key=?",['external-reference:'+r.body.id]);expect(rows).toMatchObject([{status:'PENDING',truth_record_id:null}]);
  const c=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY',externalReferenceId:r.body.id}).expect(201);expect(c.body.contextRefs).toContainEqual({type:'ExternalReference',id:r.body.id});
 });
 it('rejects whole payload as URL, absent URL, product-as-service, fabricated SHARE, and ambiguous selection outside evidence',async()=>{
  for(const patch of [{sourceUrl:rawText},{sourceUrl:'javascript:alert(1)'},{kind:'SERVICE'},{sourceUrl:'https://example.com/not-in-evidence'},{importMethod:'SHARE'}])await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({...body,...patch}).expect(400);
  await request(app.getHttpServer()).post('/api/external-services').set(auth(owner.token)).send({...body,kind:undefined,rawText:undefined}).expect(400);
 });
 it('persists optional domain independently from kind and does not require legacy category',async()=>{
  const product=await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({...body,category:undefined,domain:'work'}).expect(201);
  expect(product.body).toMatchObject({kind:'PRODUCT',domain:'work'});
  const service=await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({title:'工作服务',summary:'',sourceUrl:'https://example.com/service',sourcePlatform:'example.com',kind:'SERVICE',domain:'work',importMethod:'MANUAL'}).expect(201);
  const services=await request(app.getHttpServer()).get('/api/external-services').set(auth(owner.token)).expect(200);
  expect(services.body).toContainEqual(expect.objectContaining({id:service.body.id,kind:'SERVICE',domain:'work'}));
  expect(services.body.some((row:{id:string})=>row.id===product.body.id)).toBe(false);
  const unset=await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({...body,category:undefined}).expect(201);
  expect(unset.body.domain).toBeNull();
  await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({...body,domain:'PRODUCT'}).expect(400);
 });
 it('retains a real-format image as pending Artifact, rejects MIME forgery, and isolates evidence ownership',async()=>{
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  const image=await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send({fileName:'contract-image.png',mimeType:'image/png',contentBase64:bytes.toString('base64'),requestId:'image-contract'}).expect(201);
  expect(image.body).toMatchObject({extractionStatus:'PENDING',metadata:{ocr:false,extractionPending:true}});
  await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send({fileName:'forged.png',mimeType:'image/png',contentBase64:Buffer.from('not an image').toString('base64'),requestId:'bad-image'}).expect(400);
  await request(app.getHttpServer()).post('/api/external-references').set(auth(other.token)).send({...body,evidenceArtifactId:image.body.id}).expect(404);
  await request(app.getHttpServer()).post('/api/external-references').set(auth(owner.token)).send({...body,evidenceArtifactId:image.body.id}).expect(400);
 });
});
