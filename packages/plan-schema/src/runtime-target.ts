import {z} from 'zod';
export const RUNTIME_TARGET_TYPES=['ANDROID_DEVICE','WINDOWS_DEVICE','IOS_DEVICE','PROVIDER','MCP_SERVER','CLOUD_WORKSPACE','REMOTE_BROWSER','SERVICE_PROVIDER','USER'] as const;
export const runtimeTargetSchema=z.object({targetId:z.string().uuid(),targetType:z.enum(RUNTIME_TARGET_TYPES),ownerScope:z.string().uuid(),accountScope:z.string().nullable(),authorityEpoch:z.number().int().positive(),onlineState:z.enum(['ONLINE','OFFLINE','UNKNOWN']),health:z.enum(['HEALTHY','DEGRADED','UNAVAILABLE','UNKNOWN']),lastSeenAt:z.string().datetime().nullable(),manifestVersion:z.string().min(1),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),metadata:z.record(z.string(),z.unknown())}).strict();
export type RuntimeTarget=z.infer<typeof runtimeTargetSchema>;
export function runtimeTargetFreshness(lastSeenAt:string|null,now:string,maxAgeMs:number):RuntimeTarget['onlineState']{
 if(!lastSeenAt)return 'UNKNOWN';const seen=Date.parse(lastSeenAt),current=Date.parse(now);if(!Number.isFinite(seen)||!Number.isFinite(current)||seen>current||maxAgeMs<=0)return 'UNKNOWN';return current-seen<=maxAgeMs?'ONLINE':'OFFLINE';
}
export function assertRuntimeTargetEpoch(target:Pick<RuntimeTarget,'authorityEpoch'|'health'>,expected:number){if(target.authorityEpoch!==expected)throw new Error('STALE_AUTHORITY_EPOCH');if(target.health==='UNAVAILABLE')throw new Error('TARGET_UNAVAILABLE');}
