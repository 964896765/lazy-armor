import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalTestMcpServer, ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { outboxMessages } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { McpServerRegistryService } from '../src/mcp/mcp-server-registry.service';
import { McpExecutionRegistrationService } from '../src/mcp/mcp-execution-registration.service';
import { ExecutionWorker } from '../src/execution/execution-worker.service';
import { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('MCP through canonical ActionProposal execution', { timeout: 120000 }, () => {
 let app: INestApplication;let pool: Pool;let owner: Session;let worker: ExecutionWorker;let capability: string;let connectionId: string;let connectorKey: string;
 let writeCalls=0;let mismatch=false;const effects=new Map<string,string>();let servers: McpServerRegistryService;let server:LocalTestMcpServer;
 beforeAll(async()=> {
  const unique=String(Date.now()); connectorKey=`mcp_e2e_${unique}`;
  const model={modelId:()=> 'explicit-mcp-test-model',complete:async()=>({result:'ACTION_PROPOSAL',actionProposal:{name:'MCP 单次写入',domain:'general',actionType:'sync',config:{resource:'Task'},requiredCapability:capability,connectionId,input:{arguments:{payload:'Approved exact payload'}}},intentSummary:'写入一次',domain:'general',scenarioKey:null,scenarioRevision:null,strategyKey:null,requiredFacts:[],selectedTruthRefs:[],requiredCapabilities:[capability],selectedSkillIds:[],toolRequirements:[],draftDefinition:null,explanation:'请确认操作，然后通过审批执行。',missingRequirements:[],warnings:[],riskHints:[]})};
  const boot=await bootP2App(`mcp-execution-${unique}`,[{token:AGENT_MODEL,value:model}]);app=boot.app;pool=boot.pool;worker=boot.worker;
  owner=await register(app,`mcp-chain-${unique}@example.com`,'Owner');servers=app.get(McpServerRegistryService);
  server=new LocalTestMcpServer(`chain_${unique}`,'Explicit isolated MCP test provider');
  server.register({toolName:'write_record',description:'Writes one isolated record',effectClass:'EXTERNAL_SIDE_EFFECT',riskHint:'R0',verificationMethod:'READ_BACK',inputSchema:{type:'object',properties:{payload:{type:'string'}},required:['payload'],additionalProperties:false},outputSchema:{type:'object',properties:{operationId:{type:'string'}},required:['operationId'],additionalProperties:false},async invoke(args){writeCalls++;const id=`operation-${writeCalls}`;effects.set(id,String(args.payload));return {operationId:id};}});
  server.register({toolName:'lookup_record',description:'Reads persisted record',effectClass:'READ_ONLY',riskHint:'R0',inputSchema:{type:'object',properties:{operationId:{type:'string'}},required:['operationId'],additionalProperties:false},outputSchema:{type:'object',properties:{operationId:{type:'string'},payload:{type:'string'}},required:['operationId','payload'],additionalProperties:false},async invoke(args){return {operationId:String(args.operationId),payload:mismatch?'Different content':effects.get(String(args.operationId))??'Missing'};}});
  servers.registerServer({serverId:server.serverId,displayName:'Isolated test provider',transport:'LOCAL',serverVersion:'test',toolCatalogHash:null,trustState:'ALLOWLISTED',authorized:true,healthy:false,lastSeenAt:null},server.transport);
  await servers.discover(server.serverId);
  const installed=await app.get(McpExecutionRegistrationService).install({serverId:server.serverId,connectorKey,toolName:'write_record',readBackToolName:'lookup_record',resource:'Task',costMicros:0,schemaHash:servers.getTool(server.serverId,'write_record').schemaHash,readBackSchemaHash:servers.getTool(server.serverId,'lookup_record').schemaHash,resultIdField:'operationId',lookupIdField:'operationId',comparisons:[{readBackPath:['payload'],argumentPath:['payload']}],supportsIdempotency:false,authentication:'none',revision:1},server.transport);
  capability=installed.capabilityKey;
  const connection=await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({connectorId:connectorKey,externalAccountName:'Explicit isolated MCP provider'}).expect(201);connectionId=connection.body.id;
  await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(owner.token)).send({permissions:[{capability,granted:true}]}).expect(200);
 });
 afterAll(async()=>{await app?.close();await pool?.end();});
 async function confirmedRun() {
  const c=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY'}).expect(201);
  const proposed=await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'propose',content:'写入一次 MCP 记录'}).expect(201);
  expect(proposed.body.messages.at(-1).structuredPayload,JSON.stringify(proposed.body.messages.at(-1).structuredPayload)).toMatchObject({result:'ACTION_PROPOSAL'});
  const run=await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/confirm-action`).set(auth(owner.token)).send({messageId:proposed.body.messages.at(-1).id,version:proposed.body.version,confirmed:true}); if(run.status!==201){const [decisions]=await pool.query('SELECT decision_json FROM capability_resolution_decisions WHERE user_id=UUID_TO_BIN(?)',[owner.userId]);throw new Error(JSON.stringify({response:run.body,decisions}));}
  await worker.processExecution(run.body.executionId);
  const waiting=await request(app.getHttpServer()).get(`/api/executions/${run.body.executionId}`).set(auth(owner.token)).expect(200);expect(waiting.body.status).toBe('waiting_approval');
  await request(app.getHttpServer()).post(`/api/approvals/${waiting.body.approvals[0].id}/approve`).set(auth(owner.token)).send({}).expect(201);
  await worker.processExecution(run.body.executionId);return run.body;
 }
 async function dispatchOutbox(executionId:string) {
  const db=app.get<InjectedDatabase>(DATABASE);const messages=await db.select().from(outboxMessages).where(eq(outboxMessages.userId,owner.userId));
  const message=messages.find(item=>item.payloadJson.executionId===executionId);expect(message).toBeTruthy();await app.get(OutboxWorker).process(message!);
 }
 it('requires a canonical operation and verifies a real independent read-back', async()=> {
  const connector=app.get(ConnectorRegistry).get(connectorKey);await expect(connector.execute!({capability,input:{context:{arguments:{payload:'forged'}}},requestId:'forged'})).rejects.toThrow('canonical outbox operation');expect(writeCalls).toBe(0);
  const run=await confirmedRun();expect(writeCalls).toBe(0);await dispatchOutbox(run.executionId);expect(writeCalls).toBe(1);
  const detail=await request(app.getHttpServer()).get(`/api/executions/${run.executionId}`).set(auth(owner.token)).expect(200);expect(detail.body.status).toBe('succeeded');
  const [proof]=await pool.query('SELECT ve.method,ve.result_state FROM verification_evidence ve JOIN side_effect_operations op ON ve.operation_id=op.id WHERE op.execution_id=UUID_TO_BIN(?)',[run.executionId]);expect(proof).toEqual(expect.arrayContaining([expect.objectContaining({method:'OPERATION_LOOKUP',result_state:'SUCCEEDED'})]));
  await dispatchOutbox(run.executionId);expect(writeCalls).toBe(1);
 });
 it('keeps schema-valid mismatched read-back unknown and reconciles without another write',async()=> {
  mismatch=true;const run=await confirmedRun();await dispatchOutbox(run.executionId);expect(writeCalls).toBe(2);
  const result=await request(app.getHttpServer()).get(`/api/executions/${run.executionId}/verification`).set(auth(owner.token));expect(result.status).toBe(200);expect(result.body.resultState).toBe('OUTCOME_UNKNOWN');
  mismatch=false;const reconciliation=app.get(ReconciliationService);const cases=await reconciliation.claim(100);const current=cases.find(item=>item.executionId===run.executionId);expect(current).toBeTruthy();await reconciliation.process(current!);expect(writeCalls).toBe(2);
  const resolved=await reconciliation.executionResult(owner.userId,run.executionId);expect(resolved.resultState).toBe('SUCCEEDED');
 });
 it('rechecks a revoked capability grant after approval before any provider write',async()=> {
  const run=await confirmedRun();const before=writeCalls;
  await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(owner.token)).send({permissions:[{capability,granted:false}]}).expect(200);
  await dispatchOutbox(run.executionId);expect(writeCalls).toBe(before);
  const detail=await request(app.getHttpServer()).get(`/api/executions/${run.executionId}`).set(auth(owner.token)).expect(200);
  expect(detail.body.status).not.toBe('succeeded');
 });
});


