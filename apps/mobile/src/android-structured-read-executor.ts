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
  if (!['CLAIMED', 'RUNNING'].includes(task.status) || !task.claimToken || !task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= Date.now() || !Number.isFinite(Date.parse(task.leaseExpiresAt))) return null;
  const payload = task.payload ?? {};
  const packageName = typeof payload.packageName === 'string' ? payload.packageName : null;
  const resourceId = typeof payload.resourceId === 'string' ? payload.resourceId : null;
  const sessionId = typeof payload.appReadSessionId === 'string' ? payload.appReadSessionId : null;
  const requestedFields = Array.isArray(payload.requestedFields) ? payload.requestedFields.filter((field): field is string => typeof field === 'string') : [];
  if (!packageName || !resourceId || !sessionId) return null;
  const profile = resolveAppReadProfile(packageName);
  if (!profile) return null;
  if (!selectorsAllowed(requestedFields, profile)) return null;

  const session = await appReadSessionStatus();
  if (!session.active || !session.usageAccessGranted || session.targetPackage !== packageName || session.sessionId !== sessionId || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
  if (session.status !== 'READING') return null;
  if (session.foregroundPackage !== packageName) return null;

  const captured = await captureAppReadUiNodes(packageName, [...new Set(requestedFields)]);
  if (!captured || captured.nodes.length === 0) return null;

  const nodes = captured.nodes
    .filter((node) => nodeMatchesAllowlist(node, requestedFields))
    .filter((node) => !isSensitiveNode(node));
  if (nodes.length === 0) return null;

  // A session switch, foreground loss or expired claim during capture invalidates this read.
  const current = await appReadSessionStatus();
  if (!current.active || !current.usageAccessGranted || current.sessionId !== sessionId || current.status !== 'READING'
    || current.targetPackage !== packageName || current.foregroundPackage !== packageName || !Number.isFinite(current.expiresAt) || current.expiresAt <= Date.now()
    || Date.parse(task.leaseExpiresAt) <= Date.now()) return null;

  return {
    packageName,
    resourceId,
    observedAt: new Date().toISOString(),
    screenId: sessionId,
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

function nodeMatchesAllowlist(node: CapturedUiNode, selectors: readonly string[]): boolean {
  const selector = node.resourceId ?? node.contentDescription ?? '';
  if (!selector) return false;
  return selectors.some((allowed) => selector === allowed || selector.endsWith(`/${allowed}`) || selector.endsWith(`.${allowed}`));
}

function isSensitiveNode(node: CapturedUiNode): boolean {
  return isSensitiveField(node.resourceId ?? '') || isSensitiveField(node.contentDescription ?? '');
}
