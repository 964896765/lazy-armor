import { z } from 'zod';
import { GOAL_BRIEF_FIELDS, goalBriefRefSchema, goalBriefSchema, type GoalBrief } from './goal-brief';
import { skillMethodRefSchema, skillMethodRefsSchema, type SkillCapability, type SkillMethodRef } from './skill-capability';
import type { MethodResourceMatch } from './goal-resource-match';
import { canonicalCapabilityId } from './capability-identity';

const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
export const skillResourceGraphRequestSchema = z.object({
  version: z.number().int().nonnegative(),
  links: z.array(z.object({ fromMethodId: z.uuid(), outputField: fieldName, toMethodId: z.uuid(), inputField: fieldName }).strict()).max(32),
  goalBindings: z.array(z.object({ methodId: z.uuid(), inputField: fieldName, goalField: z.enum(GOAL_BRIEF_FIELDS) }).strict()).max(48),
  deliveries: z.array(z.object({ methodId: z.uuid(), outputField: fieldName, label: z.string().trim().min(1).max(120) }).strict()).min(1).max(12),
}).strict();
export type SkillResourceGraphRequest = z.infer<typeof skillResourceGraphRequestSchema>;
export type Primitive = 'string' | 'number' | 'integer' | 'boolean';
interface Ports { fields: Record<string, Primitive>; required: string[] }
interface Method { ref: SkillMethodRef; manifest: SkillCapability }
export interface SkillResourceGraphIssue { code: string; methodId?: string; field?: string }
export type SkillResourceGraphNode = { kind: 'METHOD'; id: string; ref: SkillMethodRef }
  | { kind: 'RESOURCE_REQUIREMENT'; id: string; methodId: string; capability: string; state: 'OBSERVED_READY' | 'GAP'; candidateIds: string[] }
  | { kind: 'OUTPUT'; id: string; methodId: string; field: string; label: string; type: Primitive };
export interface SkillResourceGraph {
  schemaVersion: 'skill-resource-graph.v1'; readOnly: true; executionAuthorized: false; runtimeRecipe: 'NOT_COMPILED';
  state: 'STRUCTURE_VALID' | 'BLOCKED'; issues: SkillResourceGraphIssue[];
  goalRef: { goalId: string; version: number } | null; methodRefs: SkillMethodRef[];
  nodes: SkillResourceGraphNode[];
  edges: Array<{ kind: 'REQUIRES_CAPABILITY' | 'CONSUMES_OUTPUT' | 'PRODUCES'; from: string; to: string; fields?: { output: string; input: string } }>;
  orderedMethodIds: string[]; riskFloor: SkillCapability['risk']; resourcesObservedAt: string;
}

export const compositionPreviewSchema = z.object({
  schemaVersion: z.literal('skill-resource-graph.v1'), readOnly: z.literal(true), executionAuthorized: z.literal(false), runtimeRecipe: z.literal('NOT_COMPILED'),
  state: z.enum(['STRUCTURE_VALID', 'BLOCKED']), issues: z.array(z.object({ code: z.string().max(120), methodId: z.uuid().optional(), field: z.string().max(160).optional() }).strict()).max(100),
  goalRef: z.object({ goalId: z.string().max(160), version: z.number().int().positive() }).strict().nullable(), methodRefs: skillMethodRefsSchema,
  nodes: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('METHOD'), id: z.uuid(), ref: skillMethodRefSchema }).strict(),
    z.object({ kind: z.literal('RESOURCE_REQUIREMENT'), id: z.string().max(300), methodId: z.uuid(), capability: z.string().max(120), state: z.enum(['OBSERVED_READY', 'GAP']), candidateIds: z.array(z.string().max(160)).max(20) }).strict(),
    z.object({ kind: z.literal('OUTPUT'), id: z.string().max(160), methodId: z.uuid(), field: fieldName, label: z.string().max(120), type: z.enum(['string', 'number', 'integer', 'boolean']) }).strict(),
  ])).max(64),
  edges: z.array(z.object({ kind: z.enum(['REQUIRES_CAPABILITY', 'CONSUMES_OUTPUT', 'PRODUCES']), from: z.string().max(300), to: z.string().max(300), fields: z.object({ output: fieldName, input: fieldName }).strict().optional() }).strict()).max(100),
  orderedMethodIds: z.array(z.uuid()).max(3), riskFloor: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']), resourcesObservedAt: z.iso.datetime(),
  conversationId: z.uuid(), conversationVersion: z.number().int().nonnegative(), previewHash: z.string().regex(/^[a-f0-9]{64}$/), evaluatedAt: z.iso.datetime(), limitation: z.string().max(500),
  goalBriefRef: goalBriefRefSchema.nullable(), sourceMessageRefs: z.array(z.object({ id: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(80),
}).strict().superRefine((preview, context) => {
  if (preview.goalRef?.goalId !== preview.goalBriefRef?.goalId || preview.goalRef?.version !== preview.goalBriefRef?.version)
    context.addIssue({ code: 'custom', message: 'Goal identities must match their immutable preview reference' });
});
export type CompositionPreview = z.infer<typeof compositionPreviewSchema>;

/** Deliberately bounded JSON Schema subset. Unsupported keywords/$ref never silently pass. */
export function skillMethodPorts(raw: Record<string, unknown>): Ports | null {
  if (Object.keys(raw).some(key => !['type', 'properties', 'required', 'additionalProperties'].includes(key)) || raw.type !== 'object' || raw.additionalProperties !== false ||
    !raw.properties || typeof raw.properties !== 'object' || Array.isArray(raw.properties)) return null;
  const properties = raw.properties as Record<string, unknown>, fields: Record<string, Primitive> = Object.create(null);
  if (Object.keys(properties).length > 16) return null;
  for (const [name, value] of Object.entries(properties)) {
    if (!fieldName.safeParse(name).success || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const property = value as Record<string, unknown>;
    if (Object.keys(property).some(key => key !== 'type') || !['string', 'number', 'integer', 'boolean'].includes(String(property.type))) return null;
    fields[name] = property.type as Primitive;
  }
  const required = raw.required ?? [];
  if (!Array.isArray(required) || required.some(name => typeof name !== 'string' || !Object.hasOwn(fields, name)) || new Set(required).size !== required.length) return null;
  return { fields, required: required as string[] };
}
const sameRef = (a: SkillMethodRef, b: SkillMethodRef) => a.repositoryId === b.repositoryId && a.repositoryVersion === b.repositoryVersion &&
  a.entryId === b.entryId && a.revisionId === b.revisionId && a.contentHash === b.contentHash;
const riskOrder: SkillCapability['risk'][] = ['R0', 'R1', 'R2', 'R3', 'R4'];

const portsSchema = z.object({ fields: z.record(fieldName, z.enum(['string', 'number', 'integer', 'boolean'])), required: z.array(fieldName).max(16) }).strict();
export const compositionOptionsSchema = z.object({
  conversationId: z.uuid(), conversationVersion: z.number().int().nonnegative(), executionAuthorized: z.literal(false),
  methods: z.array(z.object({ ref: skillMethodRefSchema, name: z.string().max(80), input: portsSchema.nullable(), output: portsSchema.nullable() }).strict()).min(1).max(3),
  goal: goalBriefSchema.nullable(), suggested: skillResourceGraphRequestSchema.nullable(),
}).strict();
export type CompositionOptions = z.infer<typeof compositionOptionsSchema>;

/** Suggest only unique same-name compatible ports. Ambiguous semantics remain for review. */
export function suggestSkillResourceGraph(version: number, methods: readonly Method[], goal: GoalBrief | null): SkillResourceGraphRequest | null {
  const request: SkillResourceGraphRequest = { version, links: [], goalBindings: [], deliveries: [] };
  for (const [index, method] of methods.entries()) {
    const input = skillMethodPorts(method.manifest.input), output = skillMethodPorts(method.manifest.output);
    if (!input || !output) continue;
    for (const [field, type] of Object.entries(input.fields)) {
      const sources = methods.slice(0, index).filter(source => {
        const sourceType = skillMethodPorts(source.manifest.output)?.fields[field];
        return sourceType === type || sourceType === 'integer' && type === 'number';
      });
      const goalField = goal?.fields.find(candidate => candidate.key === field && candidate.value && ['USER_STATED', 'ASSUMPTION'].includes(candidate.status));
      if (sources.length === 1 && !(type === 'string' && goalField)) request.links.push({ fromMethodId: sources[0].ref.entryId, outputField: field, toMethodId: method.ref.entryId, inputField: field });
      else if (!sources.length && type === 'string' && goalField) request.goalBindings.push({ methodId: method.ref.entryId, inputField: field, goalField: goalField.key });
    }
  }
  for (const method of methods) for (const field of Object.keys(skillMethodPorts(method.manifest.output)?.fields ?? {})) {
    if (!request.links.some(link => link.fromMethodId === method.ref.entryId && link.outputField === field) && request.deliveries.length < 12)
      request.deliveries.push({ methodId: method.ref.entryId, outputField: field, label: `${method.manifest.name} · ${field}`.slice(0, 120) });
  }
  return skillResourceGraphRequestSchema.safeParse(request).success ? request : null;
}

/** Structure validation only. Real bindings, budget, recipe compilation and approval remain original authorities. */
export function compileSkillResourceGraph(raw: unknown, methods: readonly Method[], goal: GoalBrief | null, resources: MethodResourceMatch): SkillResourceGraph {
  const request = skillResourceGraphRequestSchema.parse(raw);
  const methodRefs = skillMethodRefsSchema.parse(methods.map(method => method.ref));
  const issues: SkillResourceGraphIssue[] = [], nodes: SkillResourceGraphNode[] = [], edges: SkillResourceGraph['edges'] = [];
  const issue = (code: string, methodId?: string, field?: string) => { if (issues.length < 100) issues.push({ code, ...(methodId ? { methodId } : {}), ...(field ? { field } : {}) }); };
  const input = new Map<string, Ports>(), output = new Map<string, Ports>(), bindings = new Set<string>();
  let riskFloor: SkillCapability['risk'] = 'R0';
  const raiseRisk = (risk: string | undefined) => {
    if (!risk || !riskOrder.includes(risk as SkillCapability['risk'])) { issue('RESOURCE_RISK_UNKNOWN'); riskFloor = 'R4'; return; }
    if (riskOrder.indexOf(risk as SkillCapability['risk']) > riskOrder.indexOf(riskFloor)) riskFloor = risk as SkillCapability['risk'];
  };
  if (!methods.length) issue('METHOD_SELECTION_REQUIRED');
  // GoalBrief and Conversation have independent version sequences.
  if (!goal || goal.readiness.state !== 'READY_FOR_PROPOSAL') issue('GOAL_INPUT_NOT_READY');
  if (resources.conversationVersion !== request.version || (goal && resources.conversationId !== goal.goalId)) issue('RESOURCE_CONTEXT_MISMATCH');
  for (const method of methods) {
    const id = method.ref.entryId;
    nodes.push({ kind: 'METHOD', id, ref: method.ref }); raiseRisk(method.manifest.risk);
    const inPorts = skillMethodPorts(method.manifest.input), outPorts = skillMethodPorts(method.manifest.output);
    if (!inPorts) issue('INPUT_CONTRACT_UNSUPPORTED', id); else input.set(id, inPorts);
    if (!outPorts) issue('OUTPUT_CONTRACT_UNSUPPORTED', id); else output.set(id, outPorts);
    const matched = resources.methods.find(item => sameRef(item.ref, method.ref));
    if (!matched) { issue('METHOD_RESOURCE_REFERENCE_MISMATCH', id); continue; }
    for (const key of [...new Set(method.manifest.requiredCapabilities.map(key => canonicalCapabilityId(key) ?? key))]) {
      const requirement = matched.requirements.find(item => item.key === key), ready = requirement?.resources.filter(item => item.state === 'READY') ?? [];
      const resourceId = `resource:${id}:${key}`;
      nodes.push({ kind: 'RESOURCE_REQUIREMENT', id: resourceId, methodId: id, capability: key, state: ready.length ? 'OBSERVED_READY' : 'GAP', candidateIds: ready.map(item => item.resourceId).slice(0, 20) });
      edges.push({ kind: 'REQUIRES_CAPABILITY', from: id, to: resourceId });
      if (!ready.length) issue('RESOURCE_GAP', id, key);
      for (const candidate of ready) raiseRisk(candidate.riskLevel);
    }
    if (method.manifest.permission.some(permission => permission === 'WRITE' || permission === 'NOTIFY')) {
      // Declarations cannot authorize effects. An existing legal recipe is still required even at R0.
      issue('SIDE_EFFECT_RECIPE_REQUIRED', id);
    }
  }
  const adjacency = new Map(methodRefs.map(ref => [ref.entryId, new Set<string>()])), indegree = new Map(methodRefs.map(ref => [ref.entryId, 0]));
  for (const link of request.links) {
    const from = output.get(link.fromMethodId)?.fields[link.outputField], to = input.get(link.toMethodId)?.fields[link.inputField];
    if (!from || !to) { issue('MAPPING_FIELD_MISSING', link.toMethodId, link.inputField); continue; }
    if (from !== to && !(from === 'integer' && to === 'number')) issue('MAPPING_TYPE_MISMATCH', link.toMethodId, link.inputField);
    const identity = `${link.toMethodId}:${link.inputField}`;
    if (bindings.has(identity)) issue('DUPLICATE_INPUT_BINDING', link.toMethodId, link.inputField); bindings.add(identity);
    const destinations = adjacency.get(link.fromMethodId)!;
    if (!destinations.has(link.toMethodId)) { destinations.add(link.toMethodId); indegree.set(link.toMethodId, indegree.get(link.toMethodId)! + 1); }
    edges.push({ kind: 'CONSUMES_OUTPUT', from: link.fromMethodId, to: link.toMethodId, fields: { output: link.outputField, input: link.inputField } });
  }
  for (const binding of request.goalBindings) {
    const port = input.get(binding.methodId)?.fields[binding.inputField], field = goal?.fields.find(field => field.key === binding.goalField);
    if (!port || port !== 'string') issue('GOAL_MAPPING_TYPE_MISMATCH', binding.methodId, binding.inputField);
    if (!field?.value || field.status === 'UNKNOWN') issue('GOAL_FIELD_UNAVAILABLE', binding.methodId, binding.goalField);
    if (field?.status === 'CONFIRMED') issue('CONFIRMED_GOAL_SOURCE_ADAPTER_REQUIRED', binding.methodId, binding.goalField);
    const identity = `${binding.methodId}:${binding.inputField}`;
    if (bindings.has(identity)) issue('DUPLICATE_INPUT_BINDING', binding.methodId, binding.inputField); bindings.add(identity);
  }
  for (const [id, contract] of input) for (const field of contract.required) if (!bindings.has(`${id}:${field}`)) issue('REQUIRED_INPUT_MISSING', id, field);
  const outputs = new Set<string>();
  for (const delivery of request.deliveries) {
    const type = output.get(delivery.methodId)?.fields[delivery.outputField], id = `output:${delivery.methodId}:${delivery.outputField}`;
    if (!type) { issue('DELIVERY_FIELD_MISSING', delivery.methodId, delivery.outputField); continue; }
    if (outputs.has(id)) { issue('DUPLICATE_DELIVERY', delivery.methodId, delivery.outputField); continue; }
    outputs.add(id); nodes.push({ kind: 'OUTPUT', id, methodId: delivery.methodId, field: delivery.outputField, label: delivery.label, type });
    edges.push({ kind: 'PRODUCES', from: delivery.methodId, to: id });
  }
  // Deterministic topological order retains the user's selected order for independent methods.
  const orderedMethodIds: string[] = [], ready = methodRefs.filter(ref => indegree.get(ref.entryId) === 0).map(ref => ref.entryId);
  while (ready.length) {
    const id = ready.shift()!; orderedMethodIds.push(id);
    for (const next of adjacency.get(id)!) { indegree.set(next, indegree.get(next)! - 1); if (!indegree.get(next)) ready.push(next); }
  }
  if (orderedMethodIds.length !== methodRefs.length) issue('METHOD_CYCLE');
  if (nodes.length > 64) issue('GRAPH_NODE_LIMIT');
  return { schemaVersion: 'skill-resource-graph.v1', readOnly: true, executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED',
    state: issues.length ? 'BLOCKED' : 'STRUCTURE_VALID', issues, goalRef: goal ? { goalId: goal.goalId, version: goal.version } : null,
    methodRefs, nodes, edges, orderedMethodIds, riskFloor, resourcesObservedAt: resources.evaluatedAt };
}
