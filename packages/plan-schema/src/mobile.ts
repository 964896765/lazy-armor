// React Native-safe plan schema surface.
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
