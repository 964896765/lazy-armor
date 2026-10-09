import {runtimeAuthoritySourceSchema} from './runtime-authority-source';
import {z} from 'zod';
export const capabilityInvocationSchema=z.object({invocationId:z.string().uuid(),planId:z.string().uuid().nullable(),planVersionId:z.string().uuid().nullable(),executionId:z.string().uuid().nullable(),capabilityId:z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/),targetId:z.string().uuid(),arguments:z.record(z.string(),z.unknown()),resourceScope:z.record(z.string(),z.unknown()),authorityEpoch:z.number().int().positive(),timeoutMs:z.number().int().min(1).max(3600000),idempotencyKey:z.string().min(1).max(255),resolutionDecisionRef:z.string().uuid(),riskSnapshotRef:z.string().nullable(),approvalRef:z.string().nullable(),verificationContractRef:z.string().nullable(),createdAt:z.string().datetime()}).strict().superRefine((value,ctx)=>{
 if(value.planId===null||value.planVersionId===null){
  const parsed=runtimeAuthoritySourceSchema.safeParse(value.resourceScope.authoritySource);
  if(value.planId!==null||value.planVersionId!==null||!parsed.success||parsed.data.kind!=='USER_EVENT_SYNC')ctx.addIssue({code:'custom',message:'Non-Plan Invocation requires a controlled authority source'});
 } else if(value.resourceScope.authoritySource!==undefined){
  const parsed=runtimeAuthoritySourceSchema.safeParse(value.resourceScope.authoritySource);
  if(!parsed.success||parsed.data.kind!=='PLAN'||parsed.data.planId!==value.planId||parsed.data.planVersionId!==value.planVersionId)ctx.addIssue({code:'custom',message:'Invocation authority source conflicts with Plan identity'});
 }
});
export type CapabilityInvocation=z.infer<typeof capabilityInvocationSchema>;
