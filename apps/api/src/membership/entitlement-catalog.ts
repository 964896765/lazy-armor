export const MEMBERSHIP_PLAN_KEYS = ['free', 'plus'] as const;
export type MembershipPlanKey = typeof MEMBERSHIP_PLAN_KEYS[number];

export const ENTITLEMENT_CAPABILITIES = [
  'advanced_ai',
  'premium_connector',
  'advanced_summary',
  'premium_template',
] as const;
export type EntitlementCapability = typeof ENTITLEMENT_CAPABILITIES[number];

export const ENTITLEMENT_LIMITS = [
  'max_active_plans',
  'max_total_plans',
  'history_retention_days',
] as const;
export type EntitlementLimit = typeof ENTITLEMENT_LIMITS[number];

export const SECURITY_CAPABILITIES: ReadonlySet<string> = new Set([
  'permission_revoke',
  'connection_disconnect',
  'security_records_read',
  'approval',
  'risk',
  'credential_revoke',
  'data_management',
  'account_delete',
  'security_notification',
] as const);

export const ENTITLEMENT_CATALOG: Readonly<Record<MembershipPlanKey, {
  displayName: string;
  capabilities: Readonly<Record<EntitlementCapability, boolean>>;
  limits: Readonly<Record<EntitlementLimit, number>>;
}>> = Object.freeze({
  free: Object.freeze({
    displayName: '免费版',
    capabilities: Object.freeze({
      advanced_ai: false,
      premium_connector: false,
      advanced_summary: false,
      premium_template: false,
    }),
    limits: Object.freeze({
      max_active_plans: 3,
      max_total_plans: 30,
      history_retention_days: 30,
    }),
  }),
  plus: Object.freeze({
    displayName: 'Plus',
    capabilities: Object.freeze({
      advanced_ai: true,
      premium_connector: true,
      advanced_summary: true,
      premium_template: true,
    }),
    limits: Object.freeze({
      max_active_plans: 100,
      max_total_plans: 1000,
      history_retention_days: 365,
    }),
  }),
});

export function isMembershipPlanKey(value: string): value is MembershipPlanKey {
  return MEMBERSHIP_PLAN_KEYS.includes(value as MembershipPlanKey);
}
