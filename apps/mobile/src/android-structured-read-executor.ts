import { isSensitiveField, type AppReadProfile } from '@lazy-armor/plan-schema/mobile';
import { resolveAppReadProfile } from './app-read-profiles';
import { appReadSessionStatus, captureAppReadUiNodes, type CapturedUiNode } from './device-app-bridge';
import type { DeviceTask } from './device-task-client';
import type { StructuredReadResult } from './device-task-runner';

/**
 * Real Android structured read executor. It forms the controlled pipeline
 * DeviceTask -> package validation -> foreground validation -> selector
 * allowlist -> UI node capture -> sensitive-field filtering -> result, and
 * returns null (which the runner maps to DEVICE_READ_UNAVAILABLE) whenever real
 * nodes are unavailable. It never fabricates evidence and never reads
 * password / PIN / OTP / payment password / private key / recovery phrase /
 * token / cookie. The result is evidence only — it is never marked VERIFIED.
 */
export async function executeStructuredRead(task: DeviceTask): Promise<StructuredReadResult> {
  const payload = task.payload ?? {};
  const packageName = typeof payload.packageName === 'string' ? payload.packageName : null;
  const resourceId = typeof payload.resourceId === 'string' ? payload.resourceId : null;
  const requestedFields = Array.isArray(payload.requestedFields) ? payload.requestedFields.filter((field): field is string => typeof field === 'string') : [];
  if (!packageName || !resourceId) return null;
  const profile = resolveAppReadProfile(packageName);
  if (!profile) return null;
  if (!selectorsAllowed(requestedFields, profile)) return null;

  const session = await appReadSessionStatus();
  if (!session.active || !session.usageAccessGranted || session.targetPackage !== packageName) return null;
  if (session.status !== 'READING') return null;
  if (session.foregroundPackage !== packageName) return null;

  const captured = await captureAppReadUiNodes(packageName, [...profile.allowedSelectors]);
  if (!captured || captured.nodes.length === 0) return null;

  const nodes = captured.nodes
    .filter((node) => nodeMatchesAllowlist(node, profile))
    .filter((node) => !isSensitiveNode(node));
  if (nodes.length === 0) return null;

  return {
    packageName,
    resourceId,
    observedAt: new Date().toISOString(),
    ...(session.sessionId ? { screenId: session.sessionId } : {}),
    nodes,
    ...(captured.evidenceHash ? { evidenceHash: captured.evidenceHash } : {}),
  };
}

function selectorsAllowed(requestedFields: string[], profile: AppReadProfile): boolean {
  if (requestedFields.length === 0) return false;
  return requestedFields.every((field) => {
    if (field.includes('*') || isSensitiveField(field)) return false;
    if (profile.blockedFields.includes(field)) return false;
    return profile.allowedSelectors.includes(field);
  });
}

function nodeMatchesAllowlist(node: CapturedUiNode, profile: AppReadProfile): boolean {
  const selector = node.resourceId ?? node.contentDescription ?? '';
  if (!selector) return false;
  return profile.allowedSelectors.some((allowed) => selector === allowed || selector.endsWith(`/${allowed}`) || selector.endsWith(`.${allowed}`));
}

function isSensitiveNode(node: CapturedUiNode): boolean {
  return isSensitiveField(node.resourceId ?? '') || isSensitiveField(node.contentDescription ?? '');
}
