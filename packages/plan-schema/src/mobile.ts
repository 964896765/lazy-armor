// React Native-safe plan schema surface.
export * from './goal-understanding';
export * from './agent-task';
export * from './personal-memory';
// Keep this module free of Node built-ins because Metro resolves the full module graph.
export {
  CANONICAL_DOMAIN_CATALOG,
  CANONICAL_PLAN_DOMAINS,
  DOMAIN_GROUPS,
  LEGACY_PLAN_DOMAINS,
  PLAN_DOMAINS,
  canonicalPlanDomain,
  domainDefinition,
  domainGroupFor,
  type CanonicalDomainDefinition,
  type CanonicalPlanDomain,
  type DomainGroupKey,
  type LegacyPlanDomain,
  type PlanDomain,
} from './domain-catalog';

export {
  CANONICAL_SCENARIOS,
  PLAN_EXECUTION_LIFECYCLE,
  PLAN_STRATEGIES,
  PRODUCT_DOMAINS,
  productDomainFromStorageKey,
  scenariosForDomain,
  type ProductDomain,
  type ProductDomainKey,
} from './product-model';
export {
  LIFECYCLE_READ_PROJECTION_VERSION,
  LIFECYCLE_READ_STATES,
  buildLifecycleReadProjection,
  isLifecycleReadProjection,
  type LifecycleReadObservation,
  type LifecycleReadProjection,
  type LifecycleReadState,
  type LifecycleReadStep,
  type LifecycleReadStepKey,
} from './lifecycle-read-projection';

export {
  assertAppReadProfile,
  isSensitiveField,
  resolveStructuredReadOutcome,
  type AppReadProfile,
  type StructuredReadOutcome,
} from './structured-read';

export * from './local-resource-projection';

export * from './acquisition';
export * from './state-assessment';
export * from './source-resolver';

export * from './work-item';
export * from './local-capabilities';
export { UI_READ_CONSENT_VERSION, type UiReadConsent } from './app-read-session';
export * from './goal-page-read';
