import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('Artifact/Extractor document authority', { timeout: 90000 }, () => {
 let app: INestApplication; let pool: Pool; let owner: Session; let other: Session;
 beforeAll(async () => { const boot = await bootP2App(`artifacts-${Date.now()}`); app=boot.app;pool=boot.pool;owner=await register(app,`artifact-owner-${Date.now()}@example.com`,'Owner');other=await register(app,`artifact-other-${Date.now()}@example.com`,'Other'); });
 afterAll(async () => { await app?.close();await pool?.end(); });
 it.each([
  ['sample.pdf','application/pdf','PDF reference content'],
  ['sample.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','Document reference content'],
 ])('extracts %s offline and attaches only under its owner', async(fileName,mimeType,expected) => {
  const contentBase64=readFileSync(`test/fixtures/artifacts/${fileName}`).toString('base64');
  const input={fileName,mimeType,contentBase64,requestId:fileName};
  const imported=await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send(input).expect(201);
  expect(imported.body).toMatchObject({extractionStatus:'EXTRACTED',metadata:{provenance:'USER_DOCUMENT_UNVERIFIED',ocr:false}});
  expect(imported.body.sourceBase64).toBeUndefined();expect(imported.body.extractedText).toBeUndefined();
  const replay=await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send(input).expect(201);expect(replay.body.id).toBe(imported.body.id);
  await request(app.getHttpServer()).get(`/api/artifacts/${imported.body.id}`).set(auth(other.token)).expect(404);
  const c=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY'}).expect(201);
  const second=await request(app.getHttpServer()).post('/api/conversations').set(auth(other.token)).send({mode:'TEMPORARY'}).expect(201);
  await request(app.getHttpServer()).post(`/api/conversations/${second.body.id}/artifact-attachments`).set(auth(other.token)).send({artifactId:imported.body.id,requestId:'foreign'}).expect(404);
  const attached=await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/artifact-attachments`).set(auth(owner.token)).send({artifactId:imported.body.id,requestId:'attach'}).expect(201);
  const [rows]=await pool.query('SELECT content FROM consumer_attachments WHERE id=UUID_TO_BIN(?)',[attached.body.id]);expect((rows as Array<{content:string}>)[0].content).toContain(expected);
 });
 it('rejects mislabeled and invalid binary documents without creating an artifact', async() => {
  await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send({fileName:'fake.pdf',mimeType:'application/pdf',contentBase64:Buffer.from('not a PDF').toString('base64'),requestId:'fake'}).expect(400);
  await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send({fileName:'broken.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',contentBase64:Buffer.from([80,75,3,4,0,0]).toString('base64'),requestId:'broken'}).expect(400);
  const [rows]=await pool.query('SELECT COUNT(*) AS n FROM artifacts WHERE user_id=UUID_TO_BIN(?) AND request_id IN (?,?)',[owner.userId,'fake','broken']);expect((rows as Array<{n:number}>)[0].n).toBe(0);
 });
});
