import { z } from 'zod';
import { canonicalCapabilityId } from './capability-identity';
import { NATIVE_CALENDAR_CAPABILITIES } from './calendar-write';
export const runtimeTargetActionBindingSchema = z.object({
  targetType: z.literal('ANDROID_DEVICE'), targetId: z.string().uuid(), trustedDeviceId: z.string().uuid(),
  authorityEpoch: z.number().int().positive(), targetManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RuntimeTargetActionBinding = z.infer<typeof runtimeTargetActionBindingSchema>;
export function runtimeTargetCandidateId(binding: RuntimeTargetActionBinding, capability: string) {
  return `target:${binding.targetId}:${canonicalCapabilityId(capability) ?? capability}`;
}
/** Provider actions retain exact Connection identity; native actions require an explicit typed candidate. */
export function actionMatchesResolution(action: {connectionId: string | null; requiredCapability: string | null}, candidate: {
  id: string; runtimeTargetBinding?: RuntimeTargetActionBinding;
}) {
  if (action.connectionId) return !candidate.runtimeTargetBinding && candidate.id === `${action.connectionId}:${action.requiredCapability}`;
  const capability=canonicalCapabilityId(action.requiredCapability ?? '');
  if (!candidate.runtimeTargetBinding || !capability || !(NATIVE_CALENDAR_CAPABILITIES as readonly string[]).includes(capability)) return false;
  const binding = runtimeTargetActionBindingSchema.safeParse(candidate.runtimeTargetBinding);
  return binding.success && candidate.id === runtimeTargetCandidateId(binding.data, capability);
}
