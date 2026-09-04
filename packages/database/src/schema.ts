import { char, customType, datetime, index, int, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { parse as parseUuid, stringify as stringifyUuid } from 'uuid';

export const uuidBinary = customType<{ data: string; driverData: Buffer }>({
  dataType: () => 'binary(16)',
  toDriver: (value) => Buffer.from(parseUuid(value)),
  fromDriver: (value) => stringifyUuid(value),
});

const timestamps = {
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
};

export const users = mysqlTable('users', {
  id: uuidBinary('id').primaryKey(),
  status: varchar('status', { length: 32 }).notNull(),
  role: varchar('role', { length: 32 }).notNull().default('user'),
  ...timestamps,
});

export const membershipPlans = mysqlTable('membership_plans', {
  id: uuidBinary('id').primaryKey(),
  planKey: varchar('plan_key', { length: 32 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  version: int('version').notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('membership_plans_plan_key_uq').on(table.planKey)]);

export const userMemberships = mysqlTable('user_memberships', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  membershipPlanKey: varchar('membership_plan_key', { length: 32 }).notNull().references(() => membershipPlans.planKey, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull(),
  startedAt: datetime('started_at', { mode: 'date', fsp: 6 }).notNull(),
  currentPeriodStart: datetime('current_period_start', { mode: 'date', fsp: 6 }),
  currentPeriodEnd: datetime('current_period_end', { mode: 'date', fsp: 6 }),
  cancelAtPeriodEnd: int('cancel_at_period_end').notNull().default(0),
  provider: varchar('provider', { length: 64 }).notNull(),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('user_memberships_user_uq').on(table.userId),
  uniqueIndex('user_memberships_provider_subscription_uq').on(table.provider, table.externalSubscriptionId),
  index('user_memberships_status_period_idx').on(table.status, table.currentPeriodEnd),
]);

export const subscriptionCustomers = mysqlTable('subscription_customers', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 64 }).notNull(),
  externalCustomerId: varchar('external_customer_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('subscription_customers_user_provider_uq').on(table.userId, table.provider),
  uniqueIndex('subscription_customers_provider_external_uq').on(table.provider, table.externalCustomerId),
]);

export const subscriptions = mysqlTable('subscriptions', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  subscriptionCustomerId: uuidBinary('subscription_customer_id').notNull().references(() => subscriptionCustomers.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 64 }).notNull(),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }).notNull(),
  checkoutRequestId: varchar('checkout_request_id', { length: 255 }).notNull(),
  externalCheckoutId: varchar('external_checkout_id', { length: 255 }).notNull(),
  checkoutUrl: varchar('checkout_url', { length: 1024 }).notNull(),
  membershipPlanKey: varchar('membership_plan_key', { length: 32 }).notNull().references(() => membershipPlans.planKey, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull(),
  currentPeriodStart: datetime('current_period_start', { mode: 'date', fsp: 6 }),
  currentPeriodEnd: datetime('current_period_end', { mode: 'date', fsp: 6 }),
  cancelAtPeriodEnd: int('cancel_at_period_end').notNull().default(0),
  lastAppliedOccurredAt: datetime('last_applied_occurred_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('subscriptions_provider_external_uq').on(table.provider, table.externalSubscriptionId),
  uniqueIndex('subscriptions_user_checkout_request_uq').on(table.userId, table.checkoutRequestId),
  index('subscriptions_user_status_idx').on(table.userId, table.status, table.updatedAt),
]);

export const subscriptionCancellationRequests = mysqlTable('subscription_cancellation_requests', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  subscriptionId: uuidBinary('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'restrict' }),
  requestId: varchar('request_id', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('subscription_cancellation_requests_user_request_uq').on(table.userId, table.requestId),
  index('subscription_cancellation_requests_subscription_idx').on(table.subscriptionId, table.createdAt),
]);

export const subscriptionEvents = mysqlTable('subscription_events', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  subscriptionId: uuidBinary('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 64 }).notNull(),
  externalEventId: varchar('external_event_id', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  payloadSnapshotJson: json('payload_snapshot_json').$type<Record<string, unknown>>().notNull(),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 6 }).notNull(),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('subscription_events_provider_event_uq').on(table.provider, table.externalEventId),
  index('subscription_events_subscription_time_idx').on(table.subscriptionId, table.occurredAt),
  index('subscription_events_user_time_idx').on(table.userId, table.occurredAt),
]);

export const templateLifecycleVersions = mysqlTable('template_lifecycle_versions', {
  id: uuidBinary('id').primaryKey(),
  templateKey: varchar('template_key', { length: 120 }).notNull(),
  templateVersion: varchar('template_version', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  revision: int('revision').notNull().default(1),
  reason: varchar('reason', { length: 500 }),
  updatedByUserId: uuidBinary('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  submittedAt: datetime('submitted_at', { mode: 'date', fsp: 6 }),
  publishedAt: datetime('published_at', { mode: 'date', fsp: 6 }),
  deprecatedAt: datetime('deprecated_at', { mode: 'date', fsp: 6 }),
  suspendedAt: datetime('suspended_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('template_lifecycle_key_version_uq').on(table.templateKey, table.templateVersion),
  index('template_lifecycle_status_updated_idx').on(table.status, table.updatedAt),
]);

export const costBudgets = mysqlTable('cost_budgets', {
  id: uuidBinary('id').primaryKey(),
  budgetKey: varchar('budget_key', { length: 255 }).notNull(),
  scopeType: varchar('scope_type', { length: 32 }).notNull(),
  userId: uuidBinary('user_id').references(() => users.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 80 }),
  monthlyLimitMinor: int('monthly_limit_minor').notNull(),
  currency: varchar('currency', { length: 8 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('cost_budgets_key_uq').on(table.budgetKey),
  index('cost_budgets_user_status_idx').on(table.userId, table.status),
  index('cost_budgets_provider_status_idx').on(table.provider, table.status),
]);

export const profiles = mysqlTable('profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  avatar: varchar('avatar', { length: 1024 }),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
  locale: varchar('locale', { length: 32 }).notNull().default('zh-CN'),
  preferencesJson: json('preferences_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [uniqueIndex('profiles_user_id_uq').on(table.userId)]);

export const authIdentities = mysqlTable('auth_identities', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  emailVerifiedAt: datetime('email_verified_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('auth_identities_email_uq').on(table.email),
  index('auth_identities_user_id_idx').on(table.userId),
]);

export const authSessions = mysqlTable('auth_sessions', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  refreshTokenHash: char('refresh_token_hash', { length: 64 }).notNull(),
  familyId: uuidBinary('family_id').notNull(),
  clientMetadataJson: json('client_metadata_json').$type<Record<string, unknown>>(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  lastUsedAt: datetime('last_used_at', { mode: 'date', fsp: 6 }),
  revokedAt: datetime('revoked_at', { mode: 'date', fsp: 6 }),
  revokeReason: varchar('revoke_reason', { length: 100 }),
}, (table) => [
  uniqueIndex('auth_sessions_refresh_hash_uq').on(table.refreshTokenHash),
  index('auth_sessions_user_idx').on(table.userId, table.revokedAt),
]);

export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  usedAt: datetime('used_at', { mode: 'date', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('password_reset_tokens_hash_uq').on(table.tokenHash),
  index('password_reset_tokens_user_idx').on(table.userId, table.createdAt),
]);

export const connectors = mysqlTable('connectors', {
  id: uuidBinary('id').primaryKey(),
  key: varchar('connector_key', { length: 80 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 255 }).notNull().default(''),
  status: varchar('status', { length: 32 }).notNull(),
  providerType: varchar('provider_type', { length: 32 }).notNull().default('internal'),
  productionStatus: varchar('production_status', { length: 32 }).notNull().default('DISABLED'),
  authenticationType: varchar('authentication_type', { length: 32 }).notNull().default('none'),
  supportsRefresh: int('supports_refresh').notNull().default(0),
  supportsRevoke: int('supports_revoke').notNull().default(0),
  supportsWebhook: int('supports_webhook').notNull().default(0),
  supportsHealthCheck: int('supports_health_check').notNull().default(1),
  sandboxSupport: varchar('sandbox_support', { length: 32 }).notNull().default('none'),
  rateLimitStrategy: varchar('rate_limit_strategy', { length: 32 }).notNull().default('unknown'),
  adapterVersion: varchar('adapter_version', { length: 32 }).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('connectors_key_uq').on(table.key)]);

export const connectorCapabilities = mysqlTable('connector_capabilities', {
  id: uuidBinary('id').primaryKey(),
  connectorId: uuidBinary('connector_id').notNull().references(() => connectors.id, { onDelete: 'restrict' }),
  key: varchar('capability_key', { length: 100 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  operation: varchar('operation', { length: 32 }).notNull(),
  riskLevel: varchar('risk_level', { length: 8 }).notNull(),
  requiredPermission: varchar('required_permission', { length: 100 }).notNull().default(''),
  providerAvailability: varchar('provider_availability', { length: 32 }).notNull().default('disabled'),
  sideEffect: int('side_effect').notNull().default(0),
  supportsIdempotencyKey: int('supports_idempotency_key').notNull().default(0),
  supportsOperationLookup: int('supports_operation_lookup').notNull().default(0),
  retrySafety: varchar('retry_safety', { length: 32 }).notNull().default('ambiguous'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('connector_capabilities_connector_key_uq').on(table.connectorId, table.key)]);

export const credentialRefs = mysqlTable('credential_refs', {
  id: uuidBinary('id').primaryKey(),
  ref: varchar('credential_ref', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  currentVersion: int('current_version').notNull().default(1),
  rotatedAt: datetime('rotated_at', { mode: 'date', fsp: 6 }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [uniqueIndex('credential_refs_ref_uq').on(table.ref)]);

export const credentialVersions = mysqlTable('credential_versions', {
  id: uuidBinary('id').primaryKey(),
  credentialRefId: uuidBinary('credential_ref_id').notNull().references(() => credentialRefs.id, { onDelete: 'restrict' }),
  version: int('version').notNull(),
  providerRef: varchar('provider_ref', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  revokedAt: datetime('revoked_at', { mode: 'date', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('credential_versions_ref_version_uq').on(table.credentialRefId, table.version),
  index('credential_versions_ref_status_idx').on(table.credentialRefId, table.status),
]);

export const connections = mysqlTable('connections', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  connectorId: uuidBinary('connector_id').notNull().references(() => connectors.id, { onDelete: 'restrict' }),
  externalAccountName: varchar('external_account_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  statusReason: varchar('status_reason', { length: 255 }),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  credentialRefId: uuidBinary('credential_ref_id').references(() => credentialRefs.id, { onDelete: 'restrict' }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  lastCheckedAt: datetime('last_checked_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  index('connections_user_id_idx').on(table.userId),
  index('connections_connector_id_idx').on(table.connectorId),
]);

export const oauthAuthorizationStates = mysqlTable('oauth_authorization_states', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  providerKey: varchar('provider_key', { length: 80 }).notNull(),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  state: varchar('state', { length: 255 }).notNull(),
  redirectUri: varchar('redirect_uri', { length: 500 }).notNull(),
  codeVerifier: varchar('code_verifier', { length: 255 }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  consumedAt: datetime('consumed_at', { mode: 'date', fsp: 6 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('oauth_authorization_states_state_uq').on(table.state),
  index('oauth_authorization_states_user_provider_idx').on(table.userId, table.providerKey, table.expiresAt),
]);

export const connectionPermissions = mysqlTable('connection_permissions', {
  id: uuidBinary('id').primaryKey(),
  connectionId: uuidBinary('connection_id').notNull().references(() => connections.id, { onDelete: 'restrict' }),
  connectorCapabilityId: uuidBinary('connector_capability_id').notNull().references(() => connectorCapabilities.id, { onDelete: 'restrict' }),
  granted: int('granted').notNull().default(0),
  grantedAt: datetime('granted_at', { mode: 'date', fsp: 6 }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  revokedAt: datetime('revoked_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [uniqueIndex('connection_permissions_connection_capability_uq').on(table.connectionId, table.connectorCapabilityId)]);

export const deviceAppConnections = mysqlTable('device_app_connections', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  deviceId: varchar('device_id', { length: 128 }).notNull(),
  packageName: varchar('package_name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  enabled: int('enabled').notNull().default(1),
  modesJson: json('modes_json').$type<string[]>().notNull(),
  trustLevel: varchar('trust_level', { length: 32 }).notNull(),
  lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('device_app_connections_user_device_package_uq').on(table.userId, table.deviceId, table.packageName),
  index('device_app_connections_user_updated_idx').on(table.userId, table.updatedAt),
]);

export const billingRecords = mysqlTable('billing_records', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 120 }).notNull(),
  category: varchar('category', { length: 120 }).notNull(),
  billingPeriod: varchar('billing_period', { length: 20 }).notNull(),
  amountMinor: int('amount_minor').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 6 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('billing_records_user_period_idx').on(table.userId, table.billingPeriod, table.occurredAt),
  index('billing_records_user_created_idx').on(table.userId, table.createdAt),
]);

export const fileImports = mysqlTable('file_imports', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  providerKey: varchar('provider_key', { length: 80 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: int('size_bytes').notNull(),
  contentSha256: char('content_sha256', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  recordCount: int('record_count').notNull().default(0),
  errorCode: varchar('error_code', { length: 100 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  processedAt: datetime('processed_at', { mode: 'date', fsp: 6 }),
}, (table) => [
  uniqueIndex('file_imports_user_idempotency_uq').on(table.userId, table.idempotencyKey),
  index('file_imports_user_created_idx').on(table.userId, table.createdAt),
  index('file_imports_content_hash_idx').on(table.contentSha256),
]);

export const logisticsTrackingSnapshots = mysqlTable('logistics_tracking_snapshots', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  trackingNumber: varchar('tracking_number', { length: 120 }).notNull(),
  carrier: varchar('carrier', { length: 60 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  latestEvent: varchar('latest_event', { length: 255 }),
  latestEventAt: datetime('latest_event_at', { mode: 'date', fsp: 6 }),
  lastUpdatedAt: datetime('last_updated_at', { mode: 'date', fsp: 6 }).notNull(),
  deliveredAt: datetime('delivered_at', { mode: 'date', fsp: 6 }),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('logistics_snapshots_user_tracking_idx').on(table.userId, table.trackingNumber, table.lastUpdatedAt),
  index('logistics_snapshots_user_created_idx').on(table.userId, table.createdAt),
]);

export const householdSupplyProfiles = mysqlTable('household_supply_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  itemName: varchar('item_name', { length: 120 }).notNull(),
  category: varchar('category', { length: 120 }).notNull(),
  lastPurchasedAt: datetime('last_purchased_at', { mode: 'date', fsp: 6 }).notNull(),
  quantity: int('quantity').notNull(),
  estimatedUsageDays: int('estimated_usage_days').notNull(),
  estimatedRunOutAt: datetime('estimated_run_out_at', { mode: 'date', fsp: 6 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('household_supply_user_item_idx').on(table.userId, table.itemName),
  index('household_supply_user_runout_idx').on(table.userId, table.estimatedRunOutAt),
]);

export const preparedShoppingItems = mysqlTable('prepared_shopping_items', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  sourcePlanId: uuidBinary('source_plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  itemName: varchar('item_name', { length: 120 }).notNull(),
  quantitySuggestion: int('quantity_suggestion').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('prepared_shopping_items_user_dedupe_uq').on(table.userId, table.dedupeKey),
  index('prepared_shopping_items_plan_status_idx').on(table.sourcePlanId, table.status, table.createdAt),
]);

export const masterContents = mysqlTable('master_contents', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body'),
  mediaReferencesJson: json('media_references_json').$type<string[]>().notNull(),
  coverReference: varchar('cover_reference', { length: 1024 }),
  tagsJson: json('tags_json').$type<string[]>().notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  ...timestamps,
}, (table) => [
  index('master_contents_user_created_idx').on(table.userId, table.createdAt),
  index('master_contents_user_source_idx').on(table.userId, table.sourceType),
]);

export const platformVariants = mysqlTable('platform_variants', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  masterContentId: uuidBinary('master_content_id').notNull().references(() => masterContents.id, { onDelete: 'restrict' }),
  platform: varchar('platform', { length: 40 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description'),
  tagsJson: json('tags_json').$type<string[]>().notNull(),
  coverRequirements: varchar('cover_requirements', { length: 120 }).notNull(),
  publishStatus: varchar('publish_status', { length: 32 }).notNull(),
  validationResultJson: json('validation_result_json').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
}, (table) => [
  index('platform_variants_master_platform_idx').on(table.masterContentId, table.platform, table.createdAt),
  index('platform_variants_user_status_idx').on(table.userId, table.publishStatus, table.createdAt),
]);

export const importantItemCandidates = mysqlTable('important_item_candidates', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  sourceType: varchar('source_type', { length: 40 }).notNull(),
  sourceId: varchar('source_id', { length: 255 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  summary: varchar('summary', { length: 1000 }).notNull(),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 6 }).notNull(),
  dueAt: datetime('due_at', { mode: 'date', fsp: 6 }),
  senderOrOrganizer: varchar('sender_or_organizer', { length: 255 }),
  category: varchar('category', { length: 120 }).notNull(),
  importanceSignalsJson: json('importance_signals_json').$type<Record<string, unknown>>().notNull(),
  requiresAction: int('requires_action').notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex('important_item_candidates_user_source_uq').on(table.userId, table.sourceType, table.sourceId),
  index('important_item_candidates_due_idx').on(table.userId, table.dueAt, table.createdAt),
  index('important_item_candidates_source_idx').on(table.userId, table.sourceType, table.createdAt),
]);

export const studyProgressProfiles = mysqlTable('study_progress_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  sourcePlanId: uuidBinary('source_plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  currentProgressPercent: int('current_progress_percent').notNull().default(0),
  completedTaskCount: int('completed_task_count').notNull().default(0),
  missedTaskCount: int('missed_task_count').notNull().default(0),
  lastStudiedAt: datetime('last_studied_at', { mode: 'date', fsp: 6 }),
  lastGeneratedForDate: datetime('last_generated_for_date', { mode: 'date', fsp: 6 }),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  uniqueIndex('study_progress_profiles_user_plan_uq').on(table.userId, table.sourcePlanId),
  index('study_progress_profiles_plan_updated_idx').on(table.sourcePlanId, table.updatedAt),
]);

export const studyTasks = mysqlTable('study_tasks', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  sourcePlanId: uuidBinary('source_plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  studyDate: datetime('study_date', { mode: 'date', fsp: 6 }).notNull(),
  subject: varchar('subject', { length: 120 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  durationMinutes: int('duration_minutes').notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  isCatchUp: int('is_catch_up').notNull().default(0),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  completedAt: datetime('completed_at', { mode: 'date', fsp: 6 }),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  uniqueIndex('study_tasks_user_dedupe_uq').on(table.userId, table.dedupeKey),
  index('study_tasks_plan_date_idx').on(table.sourcePlanId, table.studyDate, table.createdAt),
  index('study_tasks_plan_status_idx').on(table.sourcePlanId, table.status, table.updatedAt),
]);

export const deviceProfiles = mysqlTable('device_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  type: varchar('type', { length: 80 }).notNull(),
  brand: varchar('brand', { length: 120 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  purchasedAt: datetime('purchased_at', { mode: 'date', fsp: 6 }).notNull(),
  warrantyUntil: datetime('warranty_until', { mode: 'date', fsp: 6 }),
  maintenanceIntervalDays: int('maintenance_interval_days'),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('device_profiles_user_created_idx').on(table.userId, table.createdAt),
  index('device_profiles_user_type_idx').on(table.userId, table.type),
]);

export const deviceConsumables = mysqlTable('device_consumables', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  deviceProfileId: uuidBinary('device_profile_id').notNull().references(() => deviceProfiles.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 120 }).notNull(),
  lastReplacedAt: datetime('last_replaced_at', { mode: 'date', fsp: 6 }).notNull(),
  replacementIntervalDays: int('replacement_interval_days').notNull(),
  remindBeforeDays: int('remind_before_days').notNull(),
  expectedReplaceAt: datetime('expected_replace_at', { mode: 'date', fsp: 6 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('device_consumables_profile_replace_idx').on(table.deviceProfileId, table.expectedReplaceAt, table.createdAt),
  index('device_consumables_user_status_idx').on(table.userId, table.status, table.updatedAt),
]);

export const vehicleProfiles = mysqlTable('vehicle_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  brand: varchar('brand', { length: 120 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  year: int('year').notNull(),
  purchasedAt: datetime('purchased_at', { mode: 'date', fsp: 6 }),
  mileageKm: int('mileage_km').notNull().default(0),
  mileageUpdatedAt: datetime('mileage_updated_at', { mode: 'date', fsp: 6 }).notNull(),
  insuranceExpiresAt: datetime('insurance_expires_at', { mode: 'date', fsp: 6 }),
  inspectionDueAt: datetime('inspection_due_at', { mode: 'date', fsp: 6 }),
  maintenanceDueAt: datetime('maintenance_due_at', { mode: 'date', fsp: 6 }),
  maintenanceMileageKm: int('maintenance_mileage_km'),
  tireInstalledAt: datetime('tire_installed_at', { mode: 'date', fsp: 6 }),
  batteryInstalledAt: datetime('battery_installed_at', { mode: 'date', fsp: 6 }),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('vehicle_profiles_user_created_idx').on(table.userId, table.createdAt),
  index('vehicle_profiles_user_due_idx').on(table.userId, table.inspectionDueAt, table.maintenanceDueAt),
]);

export const digitalAccountProfiles = mysqlTable('digital_account_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  serviceName: varchar('service_name', { length: 120 }).notNull(),
  subscriptionStatus: varchar('subscription_status', { length: 32 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  connectionStatus: varchar('connection_status', { length: 32 }).notNull(),
  securityReminderAt: datetime('security_reminder_at', { mode: 'date', fsp: 6 }),
  backupStatus: varchar('backup_status', { length: 32 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('digital_accounts_user_expiry_idx').on(table.userId, table.expiresAt, table.createdAt),
  index('digital_accounts_user_status_idx').on(table.userId, table.subscriptionStatus, table.connectionStatus),
]);

export const recurringItemProfiles = mysqlTable('recurring_item_profiles', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  domain: varchar('domain', { length: 32 }).notNull(),
  category: varchar('category', { length: 80 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  nextDueAt: datetime('next_due_at', { mode: 'date', fsp: 6 }).notNull(),
  recurrenceDays: int('recurrence_days'),
  remindBeforeDays: int('remind_before_days').notNull().default(7),
  status: varchar('status', { length: 32 }).notNull(),
  lastCompletedAt: datetime('last_completed_at', { mode: 'date', fsp: 6 }),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('recurring_items_user_due_idx').on(table.userId, table.status, table.nextDueAt),
  index('recurring_items_user_domain_idx').on(table.userId, table.domain, table.category),
]);

export const operationalRecords = mysqlTable('operational_records', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  recordType: varchar('record_type', { length: 32 }).notNull(),
  subject: varchar('subject', { length: 160 }).notNull(),
  quantity: int('quantity'),
  amountMinor: int('amount_minor'),
  currency: char('currency', { length: 3 }),
  status: varchar('status', { length: 32 }).notNull(),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 6 }).notNull(),
  needsAttention: int('needs_attention').notNull().default(0),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  index('operational_records_user_time_idx').on(table.userId, table.occurredAt, table.recordType),
  index('operational_records_user_attention_idx').on(table.userId, table.needsAttention, table.status),
]);

export const webhookReceipts = mysqlTable('webhook_receipts', {
  id: uuidBinary('id').primaryKey(),
  connectionId: uuidBinary('connection_id').notNull().references(() => connections.id, { onDelete: 'restrict' }),
  eventId: varchar('event_id', { length: 255 }).notNull(),
  requestId: varchar('request_id', { length: 255 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  payload: text('payload').notNull(),
  payloadSnapshotJson: json('payload_snapshot_json').$type<Record<string, unknown>>(),
  payloadSizeBytes: int('payload_size_bytes'),
  receivedAt: datetime('received_at', { mode: 'date', fsp: 6 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
  purgedAt: datetime('purged_at', { mode: 'date', fsp: 6 }),
}, (table) => [
  uniqueIndex('webhook_receipts_connection_event_uq').on(table.connectionId, table.eventId),
  uniqueIndex('webhook_receipts_connection_idempotency_uq').on(table.connectionId, table.idempotencyKey),
  index('webhook_receipts_retention_idx').on(table.expiresAt, table.purgedAt),
]);

export const plans = mysqlTable('plans', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull(),
  currentVersionId: uuidBinary('current_version_id'),
  activeVersionId: uuidBinary('active_version_id'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
  archivedAt: datetime('archived_at', { mode: 'date', fsp: 6 }),
}, (table) => [index('plans_user_id_idx').on(table.userId)]);

export const planVersions = mysqlTable('plan_versions', {
  id: uuidBinary('id').primaryKey(),
  planId: uuidBinary('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  versionNumber: int('version_number').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  domain: varchar('domain', { length: 64 }).notNull(),
  automationLevel: varchar('automation_level', { length: 8 }).notNull(),
  approvalPolicyJson: json('approval_policy_json').$type<Record<string, unknown>>(),
  templateKey: varchar('template_key', { length: 120 }),
  templateVersion: varchar('template_version', { length: 32 }),
  templateConfigJson: json('template_config_json').$type<Record<string, unknown>>(),
  definitionHash: char('definition_hash', { length: 64 }).notNull(),
  createdBy: uuidBinary('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('plan_versions_plan_number_uq').on(table.planId, table.versionNumber),
  index('plan_versions_created_by_idx').on(table.createdBy),
]);

export const planSources = mysqlTable('plan_sources', {
  id: uuidBinary('id').primaryKey(),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  sourceType: varchar('source_type', { length: 40 }).notNull(),
  connectorId: uuidBinary('connector_id').references(() => connectors.id, { onDelete: 'restrict' }),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  configJson: json('config_json').$type<Record<string, unknown>>().notNull(),
  sortOrder: int('sort_order').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('plan_sources_version_order_uq').on(table.planVersionId, table.sortOrder)]);

export const planTriggers = mysqlTable('plan_triggers', {
  id: uuidBinary('id').primaryKey(),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  triggerType: varchar('trigger_type', { length: 40 }).notNull(),
  configJson: json('config_json').$type<Record<string, unknown>>().notNull(),
  sortOrder: int('sort_order').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('plan_triggers_version_order_uq').on(table.planVersionId, table.sortOrder)]);

export const planConditions = mysqlTable('plan_conditions', {
  id: uuidBinary('id').primaryKey(),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  groupId: varchar('group_id', { length: 64 }).notNull(),
  logicalOperator: varchar('logical_operator', { length: 8 }).notNull(),
  fieldPath: varchar('field_path', { length: 128 }).notNull(),
  operator: varchar('operator', { length: 40 }).notNull(),
  comparisonValueJson: json('comparison_value_json').$type<unknown>(),
  sortOrder: int('sort_order').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('plan_conditions_version_order_uq').on(table.planVersionId, table.sortOrder)]);

export const planActions = mysqlTable('plan_actions', {
  id: uuidBinary('id').primaryKey(),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  actionType: varchar('action_type', { length: 64 }).notNull(),
  connectorId: uuidBinary('connector_id').references(() => connectors.id, { onDelete: 'restrict' }),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  requiredCapability: varchar('required_capability', { length: 100 }),
  riskLevel: varchar('risk_level', { length: 8 }).notNull(),
  configJson: json('config_json').$type<Record<string, unknown>>().notNull(),
  stepOrder: int('step_order').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('plan_actions_version_step_uq').on(table.planVersionId, table.stepOrder)]);

export const executions = mysqlTable('executions', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  planId: uuidBinary('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  definitionHash: char('definition_hash', { length: 64 }).notNull(),
  requestId: varchar('request_id', { length: 255 }).notNull(),
  retryOfExecutionId: uuidBinary('retry_of_execution_id'),
  triggerType: varchar('trigger_type', { length: 32 }).notNull(),
  triggerPayloadJson: json('trigger_payload_json').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  declaredRiskLevel: varchar('declared_risk_level', { length: 8 }).notNull(),
  approvalStatus: varchar('approval_status', { length: 32 }).notNull(),
  executionPolicyVersion: varchar('execution_policy_version', { length: 32 }).notNull(),
  resolvedRetryPolicyJson: json('resolved_retry_policy_json').$type<Record<string, unknown>>().notNull(),
  resolvedFallbackPolicyJson: json('resolved_fallback_policy_json').$type<Record<string, unknown>>().notNull(),
  riskPolicyVersion: varchar('risk_policy_version', { length: 32 }),
  resolvedRiskSnapshotJson: json('resolved_risk_snapshot_json').$type<Record<string, unknown>>(),
  resolvedApprovalPolicyJson: json('resolved_approval_policy_json').$type<Record<string, unknown>>(),
  resultCode: varchar('result_code', { length: 100 }),
  resultSummary: varchar('result_summary', { length: 1000 }),
  errorCode: varchar('error_code', { length: 100 }),
  errorMessage: varchar('error_message', { length: 1000 }),
  cancellationRequestedAt: datetime('cancellation_requested_at', { mode: 'date', fsp: 6 }),
  queuedAt: datetime('queued_at', { mode: 'date', fsp: 6 }),
  startedAt: datetime('started_at', { mode: 'date', fsp: 6 }),
  finishedAt: datetime('finished_at', { mode: 'date', fsp: 6 }),
  workerToken: varchar('worker_token', { length: 100 }),
  heartbeatAt: datetime('heartbeat_at', { mode: 'date', fsp: 6 }),
  leaseExpiresAt: datetime('lease_expires_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('executions_user_request_uq').on(table.userId, table.requestId),
  index('executions_user_created_idx').on(table.userId, table.createdAt),
  index('executions_plan_created_idx').on(table.planId, table.createdAt),
  index('executions_status_updated_idx').on(table.status, table.updatedAt),
  index('executions_lease_recovery_idx').on(table.status, table.leaseExpiresAt),
]);

export const executionSteps = mysqlTable('execution_steps', {
  id: uuidBinary('id').primaryKey(),
  executionId: uuidBinary('execution_id').notNull().references(() => executions.id, { onDelete: 'restrict' }),
  planActionId: uuidBinary('plan_action_id').notNull().references(() => planActions.id, { onDelete: 'restrict' }),
  stepOrder: int('step_order').notNull(),
  actionType: varchar('action_type', { length: 64 }).notNull(),
  connectorId: uuidBinary('connector_id').references(() => connectors.id, { onDelete: 'restrict' }),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  requiredCapability: varchar('required_capability', { length: 100 }),
  declaredRiskLevel: varchar('declared_risk_level', { length: 8 }).notNull(),
  effectiveRiskLevel: varchar('effective_risk_level', { length: 8 }),
  riskSnapshotJson: json('risk_snapshot_json').$type<Record<string, unknown>>(),
  inputFingerprint: char('input_fingerprint', { length: 64 }),
  approvalGateStatus: varchar('approval_gate_status', { length: 32 }),
  dispatchStatus: varchar('dispatch_status', { length: 32 }),
  status: varchar('status', { length: 32 }).notNull(),
  attemptCount: int('attempt_count').notNull().default(0),
  retryCount: int('retry_count').notNull().default(0),
  inputSnapshotJson: json('input_snapshot_json').$type<Record<string, unknown>>(),
  outputSnapshotJson: json('output_snapshot_json').$type<Record<string, unknown>>(),
  nextRetryAt: datetime('next_retry_at', { mode: 'date', fsp: 6 }),
  startedAt: datetime('started_at', { mode: 'date', fsp: 6 }),
  finishedAt: datetime('finished_at', { mode: 'date', fsp: 6 }),
  errorCode: varchar('error_code', { length: 100 }),
  errorMessage: varchar('error_message', { length: 1000 }),
  fallbackResultJson: json('fallback_result_json').$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  uniqueIndex('execution_steps_execution_order_uq').on(table.executionId, table.stepOrder),
  index('execution_steps_status_retry_idx').on(table.status, table.nextRetryAt),
]);

export const executionEvents = mysqlTable('execution_events', {
  id: uuidBinary('id').primaryKey(),
  executionId: uuidBinary('execution_id').notNull().references(() => executions.id, { onDelete: 'restrict' }),
  executionStepId: uuidBinary('execution_step_id').references(() => executionSteps.id, { onDelete: 'restrict' }),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  dataJson: json('data_json').$type<Record<string, unknown>>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [index('execution_events_execution_created_idx').on(table.executionId, table.createdAt)]);

export const approvalPolicies = mysqlTable('approval_policies', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  policyType: varchar('policy_type', { length: 40 }).notNull(),
  configJson: json('config_json').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('approval_policies_user_version_uq').on(table.userId, table.planVersionId)]);

export const approvalRequests = mysqlTable('approval_requests', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  executionId: uuidBinary('execution_id').notNull().references(() => executions.id, { onDelete: 'restrict' }),
  executionStepId: uuidBinary('execution_step_id').notNull().references(() => executionSteps.id, { onDelete: 'restrict' }),
  planId: uuidBinary('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  planActionId: uuidBinary('plan_action_id').notNull().references(() => planActions.id, { onDelete: 'restrict' }),
  actionType: varchar('action_type', { length: 64 }),
  policySnapshotJson: json('policy_snapshot').$type<Record<string, unknown>>(),
  reason: varchar('reason', { length: 500 }),
  requestedAt: datetime('requested_at', { mode: 'date', fsp: 6 }),
  inputFingerprint: char('input_fingerprint', { length: 64 }).notNull(),
  contextHash: char('context_hash', { length: 64 }).notNull(),
  effectiveRiskLevel: varchar('effective_risk_level', { length: 8 }).notNull(),
  amountMinor: int('amount_minor'),
  currency: char('currency', { length: 3 }),
  actionSummary: varchar('action_summary', { length: 500 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  decidedAt: datetime('decided_at', { mode: 'date', fsp: 6 }),
  decision: varchar('decision', { length: 32 }),
  decisionReason: varchar('decision_reason', { length: 500 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('approval_requests_execution_step_uq').on(table.executionId, table.executionStepId),
  index('approval_requests_user_status_idx').on(table.userId, table.status, table.expiresAt),
]);

export const approvalDecisions = mysqlTable('approval_decisions', {
  id: uuidBinary('id').primaryKey(),
  approvalRequestId: uuidBinary('approval_request_id').notNull().references(() => approvalRequests.id, { onDelete: 'restrict' }),
  actorUserId: uuidBinary('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  decision: varchar('decision', { length: 32 }).notNull(),
  reason: varchar('reason', { length: 500 }),
  deviceContextJson: json('device_context_json').$type<Record<string, unknown>>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [uniqueIndex('approval_decisions_request_uq').on(table.approvalRequestId)]);

export const temporaryAuthorizations = mysqlTable('temporary_authorizations', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  planId: uuidBinary('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  capabilityKey: varchar('capability_key', { length: 100 }),
  actionType: varchar('action_type', { length: 64 }),
  maximumRiskLevel: varchar('maximum_risk_level', { length: 8 }).notNull(),
  amountLimitMinor: int('amount_limit_minor'),
  currency: char('currency', { length: 3 }),
  validFrom: datetime('valid_from', { mode: 'date', fsp: 6 }),
  status: varchar('status', { length: 32 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  revokedAt: datetime('revoked_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [index('temporary_authorizations_scope_idx').on(table.userId, table.planVersionId, table.status, table.expiresAt)]);

export const notifications = mysqlTable('notifications', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  executionId: uuidBinary('execution_id').references(() => executions.id, { onDelete: 'restrict' }),
  executionStepId: uuidBinary('execution_step_id').references(() => executionSteps.id, { onDelete: 'restrict' }),
  approvalRequestId: uuidBinary('approval_request_id').references(() => approvalRequests.id, { onDelete: 'restrict' }),
  priority: varchar('priority', { length: 8 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  titleKey: varchar('title_key', { length: 120 }),
  messageKey: varchar('message_key', { length: 120 }),
  messageParamsJson: json('message_params').$type<Record<string, unknown>>(),
  actionType: varchar('action_type', { length: 64 }),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  body: varchar('body', { length: 1000 }).notNull(),
  actionRequired: int('action_required').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull(),
  readAt: datetime('read_at', { mode: 'date', fsp: 6 }),
  archivedAt: datetime('archived_at', { mode: 'date', fsp: 6 }),
  ...timestamps,
}, (table) => [
  uniqueIndex('notifications_user_dedupe_uq').on(table.userId, table.dedupeKey),
  index('notifications_user_priority_created_idx').on(table.userId, table.priority, table.createdAt),
]);

export const sideEffectOperations = mysqlTable('side_effect_operations', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  executionId: uuidBinary('execution_id').notNull().references(() => executions.id, { onDelete: 'restrict' }),
  executionStepId: uuidBinary('execution_step_id').notNull().references(() => executionSteps.id, { onDelete: 'restrict' }),
  planId: uuidBinary('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  planVersionId: uuidBinary('plan_version_id').notNull().references(() => planVersions.id, { onDelete: 'restrict' }),
  planActionId: uuidBinary('plan_action_id').notNull().references(() => planActions.id, { onDelete: 'restrict' }),
  actionType: varchar('action_type', { length: 64 }).notNull(),
  connectorId: uuidBinary('connector_id').references(() => connectors.id, { onDelete: 'restrict' }),
  connectionId: uuidBinary('connection_id').references(() => connections.id, { onDelete: 'restrict' }),
  capabilityKey: varchar('capability_key', { length: 100 }),
  idempotencyKey: char('idempotency_key', { length: 64 }).notNull(),
  inputFingerprint: char('input_fingerprint', { length: 64 }).notNull(),
  requestSnapshotJson: json('request_snapshot_json').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  providerOperationId: varchar('provider_operation_id', { length: 255 }),
  providerIdempotencyKey: varchar('provider_idempotency_key', { length: 255 }),
  attemptCount: int('attempt_count').notNull().default(0),
  resultSnapshotJson: json('result_snapshot_json').$type<Record<string, unknown>>(),
  resultHash: char('result_hash', { length: 64 }),
  errorCode: varchar('error_code', { length: 100 }),
  errorMessage: varchar('error_message', { length: 1000 }),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  causationId: varchar('causation_id', { length: 255 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  startedAt: datetime('started_at', { mode: 'date', fsp: 6 }),
  finishedAt: datetime('finished_at', { mode: 'date', fsp: 6 }),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('side_effect_operations_user_key_uq').on(table.userId, table.idempotencyKey),
  index('side_effect_operations_execution_idx').on(table.executionId, table.executionStepId),
  index('side_effect_operations_status_idx').on(table.status, table.updatedAt),
]);

export const outboxMessages = mysqlTable('outbox_messages', {
  id: uuidBinary('id').primaryKey(),
  aggregateType: varchar('aggregate_type', { length: 40 }).notNull(),
  aggregateId: uuidBinary('aggregate_id').notNull(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  destination: varchar('destination', { length: 80 }).notNull(),
  payloadJson: json('payload_json').$type<Record<string, unknown>>().notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  causationId: varchar('causation_id', { length: 255 }),
  status: varchar('status', { length: 32 }).notNull(),
  attemptCount: int('attempt_count').notNull().default(0),
  nextAttemptAt: datetime('next_attempt_at', { mode: 'date', fsp: 6 }).notNull(),
  lockedBy: varchar('locked_by', { length: 100 }),
  lockExpiresAt: datetime('lock_expires_at', { mode: 'date', fsp: 6 }),
  lastErrorCode: varchar('last_error_code', { length: 100 }),
  lastErrorMessage: varchar('last_error_message', { length: 1000 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
  publishedAt: datetime('published_at', { mode: 'date', fsp: 6 }),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('outbox_messages_dedupe_uq').on(table.dedupeKey),
  index('outbox_messages_dispatch_idx').on(table.status, table.nextAttemptAt),
]);

export const auditLogs = mysqlTable('audit_logs', {
  id: uuidBinary('id').primaryKey(),
  actorType: varchar('actor_type', { length: 32 }).notNull(),
  actorUserId: uuidBinary('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  resourceId: varchar('resource_id', { length: 64 }),
  userId: uuidBinary('user_id').references(() => users.id, { onDelete: 'restrict' }),
  executionId: uuidBinary('execution_id').references(() => executions.id, { onDelete: 'restrict' }),
  executionStepId: uuidBinary('execution_step_id').references(() => executionSteps.id, { onDelete: 'restrict' }),
  approvalRequestId: uuidBinary('approval_request_id').references(() => approvalRequests.id, { onDelete: 'restrict' }),
  sideEffectOperationId: uuidBinary('side_effect_operation_id').references(() => sideEffectOperations.id, { onDelete: 'restrict' }),
  outboxMessageId: uuidBinary('outbox_message_id').references(() => outboxMessages.id, { onDelete: 'restrict' }),
  requestId: varchar('request_id', { length: 255 }),
  correlationId: varchar('correlation_id', { length: 255 }),
  causationId: varchar('causation_id', { length: 255 }),
  beforeSnapshotJson: json('before_snapshot_json').$type<Record<string, unknown>>(),
  afterSnapshotJson: json('after_snapshot_json').$type<Record<string, unknown>>(),
  changeSummary: varchar('change_summary', { length: 1000 }),
  source: varchar('source', { length: 40 }).notNull(),
  result: varchar('result', { length: 32 }).notNull(),
  reasonCode: varchar('reason_code', { length: 100 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
  index('audit_logs_correlation_idx').on(table.correlationId),
  index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
]);

export const usageEvents = mysqlTable('usage_events', {
  id: uuidBinary('id').primaryKey(),
  userId: uuidBinary('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  usageType: varchar('usage_type', { length: 64 }).notNull(),
  quantity: int('quantity').notNull(),
  unit: varchar('unit', { length: 32 }).notNull(),
  provider: varchar('provider', { length: 80 }),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }).notNull(),
  executionId: uuidBinary('execution_id').references(() => executions.id, { onDelete: 'restrict' }),
  sideEffectOperationId: uuidBinary('side_effect_operation_id').references(() => sideEffectOperations.id, { onDelete: 'restrict' }),
  usageIdentity: varchar('usage_identity', { length: 255 }).notNull(),
  billable: int('billable').notNull().default(0),
  providerCostMinor: int('provider_cost_minor'),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 6 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 }).notNull(),
}, (table) => [
  uniqueIndex('usage_events_identity_uq').on(table.usageIdentity),
  index('usage_events_user_time_type_idx').on(table.userId, table.occurredAt, table.usageType),
  index('usage_events_execution_idx').on(table.executionId, table.usageType),
  index('usage_events_side_effect_idx').on(table.sideEffectOperationId, table.usageType),
]);

export const schema = {
  users,
  membershipPlans,
  userMemberships,
  subscriptionCustomers,
  subscriptions,
  subscriptionEvents,
  subscriptionCancellationRequests,
  templateLifecycleVersions,
  costBudgets,
  profiles,
  authIdentities,
  authSessions,
  passwordResetTokens,
  connectors,
  connectorCapabilities,
  credentialRefs,
  credentialVersions,
  connections,
  oauthAuthorizationStates,
  connectionPermissions,
  billingRecords,
  fileImports,
  logisticsTrackingSnapshots,
  householdSupplyProfiles,
  preparedShoppingItems,
  masterContents,
  platformVariants,
  importantItemCandidates,
  studyProgressProfiles,
  studyTasks,
  deviceProfiles,
  deviceConsumables,
  vehicleProfiles,
  digitalAccountProfiles,
  webhookReceipts,
  plans,
  planVersions,
  planSources,
  planTriggers,
  planConditions,
  planActions,
  executions,
  executionSteps,
  executionEvents,
  approvalPolicies,
  approvalRequests,
  approvalDecisions,
  temporaryAuthorizations,
  notifications,
  sideEffectOperations,
  outboxMessages,
  auditLogs,
  usageEvents,
};
