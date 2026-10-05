import { z } from 'zod';

/** Signed per-operation receipt. Verifies owned bytes, never the semantic facts in them. */
export const artifactAcquisitionItemSchema=z.object({
 artifactId:z.string().uuid(),
 sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
 acquisitionMethod:z.enum(['ANDROID_DOCUMENT_PICKER','ANDROID_SHARE_INTENT']),
 userConfirmed:z.literal(true),
 operationPermission:z.literal('GRANTED'),
 readSucceeded:z.literal(true),
 receivedAt:z.number().finite(),
}).strict();

export function artifactReceiptMatchesCapability(capability:string,method:string):boolean {
 return capability==='files.read'&&method==='ANDROID_DOCUMENT_PICKER'||capability==='share.read'&&method==='ANDROID_SHARE_INTENT';
}
