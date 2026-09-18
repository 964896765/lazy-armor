import { PLAN_EXECUTION_LIFECYCLE } from './product-model';

/**
 * The only lifecycle shape exposed to read clients. It deliberately contains
 * every canonical stage exactly once and never fills missing evidence with a
 * successful state. Runtime producers can attach only observed stage states;
 * all other stages remain NOT_REACHED.
 */
export const LIFECYCLE_READ_PROJECTION_VERSION = '1' as const;
export const LIFECYCLE_READ_STATES = [
  'NOT_REACHED',
  'UNKNOWN',
  'RUNNING',
  'SUCCEEDED',
  'SKIPPED',
  'BLOCKED',
  'FAILED',
  'OUTCOME_UNKNOWN',
] as const;

export type LifecycleReadState = typeof LIFECYCLE_READ_STATES[number];
export type LifecycleReadStepKey = typeof PLAN_EXECUTION_LIFECYCLE[number]['key'];

export interface LifecycleReadObservation {
  key: LifecycleReadStepKey;
  state: Exclude<LifecycleReadState, 'NOT_REACHED'>;
  /** A stable evidence/reason code; it is not a generated execution result. */
  reason?: string;
}

export interface LifecycleReadStep {
  step: number;
  key: LifecycleReadStepKey;
  label: string;
  state: LifecycleReadState;
  reason: string | null;
}

export interface LifecycleReadProjection {
  schemaVersion: typeof LIFECYCLE_READ_PROJECTION_VERSION;
  readOnly: true;
  steps: readonly LifecycleReadStep[];
}

const lifecycleKeys = new Set<string>(PLAN_EXECUTION_LIFECYCLE.map((step) => step.key));
if (PLAN_EXECUTION_LIFECYCLE.length !== 15 || lifecycleKeys.size !== 15) {
  throw new Error('The canonical lifecycle must contain exactly 15 unique steps');
}

/**
 * Builds the canonical read projection without inferring progress. Consumers
 * therefore distinguish a stage that was never reached from an observed but
 * indeterminate outcome (UNKNOWN or OUTCOME_UNKNOWN).
 */
export function buildLifecycleReadProjection(observations: readonly LifecycleReadObservation[] = []): LifecycleReadProjection {
  const observed = new Map<LifecycleReadStepKey, LifecycleReadObservation>();
  for (const observation of observations) {
    if (!lifecycleKeys.has(observation.key)) throw new Error(`Unknown lifecycle step: ${observation.key}`);
    if (!LIFECYCLE_READ_STATES.includes(observation.state)) throw new Error(`Unknown lifecycle state: ${observation.state}`);
    if (observed.has(observation.key)) throw new Error(`Duplicate lifecycle observation: ${observation.key}`);
    observed.set(observation.key, observation);
  }

  return {
    schemaVersion: LIFECYCLE_READ_PROJECTION_VERSION,
    readOnly: true,
    steps: PLAN_EXECUTION_LIFECYCLE.map((definition) => {
      const observation = observed.get(definition.key);
      return {
        ...definition,
        state: observation?.state ?? 'NOT_REACHED',
        reason: observation?.reason ?? null,
      };
    }),
  };
}

export function isLifecycleReadProjection(value: LifecycleReadProjection): boolean {
  return value.readOnly
    && value.schemaVersion === LIFECYCLE_READ_PROJECTION_VERSION
    && value.steps.length === 15
    && new Set(value.steps.map((step) => step.key)).size === 15
    && value.steps.every((step, index) => step.step === index + 1
      && step.key === PLAN_EXECUTION_LIFECYCLE[index]?.key
      && step.label === PLAN_EXECUTION_LIFECYCLE[index]?.label
      && LIFECYCLE_READ_STATES.includes(step.state));
}
