import {describe,it,expect} from 'vitest';
import {artifactAcquisitionItemSchema,artifactReceiptMatchesCapability} from '../src/consumer/artifact-acquisition-contract';
const receipt={artifactId:'01a1073e-0506-77bf-8611-a302ef2eadbd',sourceSha256:'a'.repeat(64),acquisitionMethod:'ANDROID_DOCUMENT_PICKER',userConfirmed:true,operationPermission:'GRANTED',readSucceeded:true,receivedAt:Date.now()};
describe('per-operation Artifact Acquisition receipt',()=>{
 it('requires explicit consent, successful read and exact byte hash',()=>{
  expect(artifactAcquisitionItemSchema.safeParse(receipt).success).toBe(true);
  for(const invalid of [{userConfirmed:false},{readSucceeded:false},{operationPermission:'ON_DEMAND'},{sourceSha256:'missing'},{acquisitionMethod:'MANUAL'}])expect(artifactAcquisitionItemSchema.safeParse({...receipt,...invalid}).success).toBe(false);
 });
 it('does not treat file picker or a manual import as an Android share',()=>{
  expect(artifactReceiptMatchesCapability('files.read','ANDROID_DOCUMENT_PICKER')).toBe(true);
  expect(artifactReceiptMatchesCapability('share.read','ANDROID_DOCUMENT_PICKER')).toBe(false);
  expect(artifactReceiptMatchesCapability('share.read','MANUAL')).toBe(false);
  expect(artifactReceiptMatchesCapability('share.read','ANDROID_SHARE_INTENT')).toBe(true);
 });
});
