import { z } from 'zod';
import { skillMethodRefSchema } from './skill-capability';
import { skillMethodPorts, type Primitive } from './skill-resource-graph';
import type { ReportComposition, ReportSource } from './agent-report';

const field = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(key => !['__proto__', 'prototype', 'constructor'].includes(key));
const primitive = z.union([z.string().max(12000), z.number().finite(), z.boolean()]);
export const reportMethodValuesSchema = z.record(field, primitive).superRefine((value, ctx) => {
  if (Object.keys(value).length > 16 || Object.values(value).reduce<number>((count, item) => count + (typeof item === 'string' ? item.length : 0), 0) > 32000)
    ctx.addIssue({ code: 'custom', message: 'Method values exceed the bounded field or text limit' });
});
export const reportMethodRunSchema = z.object({
  methodRef: skillMethodRefSchema, inputs: reportMethodValuesSchema, outputs: reportMethodValuesSchema,
  sourceIds: z.array(z.string().min(1).max(100)).max(7),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), outputHash: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.iso.datetime(), modelId: z.string().min(1).max(120),
  verification: z.literal('CONTRACT_CHECKED_ONLY'), provenance: z.literal('MODEL_GENERATED_UNVERIFIED'), semanticVerified: z.literal(false),
}).strict();
export type ReportMethodValues = z.infer<typeof reportMethodValuesSchema>;
export type ReportMethodRun = z.infer<typeof reportMethodRunSchema>;
export type ReportMethod = ReportComposition['methods'][number];

function scalar(type: Primitive, nonempty = false) {
  if (type === 'string') return nonempty ? z.string().min(1).max(12000) : z.string().max(12000);
  if (type === 'integer') return z.number().int();
  if (type === 'number') return z.number().finite();
  return z.boolean();
}
function valuesContract(raw: ReportMethod['manifest']['input'], additionallyRequired: string[] = []) {
  const ports = skillMethodPorts(raw);
  if (!ports || additionallyRequired.some(key => !Object.hasOwn(ports.fields, key))) throw new Error('REPORT_METHOD_CONTRACT_UNSUPPORTED');
  const required = new Set([...ports.required, ...additionallyRequired]);
  const fields: Record<string, z.ZodType> = Object.create(null);
  for (const [key, type] of Object.entries(ports.fields)) fields[key] = required.has(key) ? scalar(type, additionallyRequired.includes(key)) : scalar(type).optional();
  return z.object(fields).strict().superRefine((value, ctx) => {
    if (!reportMethodValuesSchema.safeParse(value).success) ctx.addIssue({ code: 'custom', message: 'Method values exceed the bounded contract' });
  });
}

export function resolveReportMethodInputs(composition: ReportComposition, method: ReportMethod, previous: ReportMethodRun[]): ReportMethodValues {
  const graph = composition.snapshot.selection.graph, values: ReportMethodValues = Object.create(null);
  for (const binding of graph.goalBindings.filter(item => item.methodId === method.ref.entryId)) {
    const source = composition.snapshot.sourceGoal.fields.find(item => item.key === binding.goalField);
    if (!source?.value || !['USER_STATED', 'ASSUMPTION'].includes(source.status) || Object.hasOwn(values, binding.inputField)) throw new Error('REPORT_METHOD_INPUT_INVALID');
    values[binding.inputField] = source.value;
  }
  for (const link of graph.links.filter(item => item.toMethodId === method.ref.entryId)) {
    const source = previous.find(run => run.methodRef.entryId === link.fromMethodId);
    if (!source || !Object.hasOwn(source.outputs, link.outputField)) throw new Error('REPORT_METHOD_UPSTREAM_REQUIRED');
    if (Object.hasOwn(values, link.inputField)) throw new Error('REPORT_METHOD_INPUT_INVALID');
    values[link.inputField] = source.outputs[link.outputField];
  }
  const contract = valuesContract(method.manifest.input);
  if (!contract.safeParse(values).success) throw new Error('REPORT_METHOD_INPUT_INVALID');
  return reportMethodValuesSchema.parse(values);
}

/** A node sees its own fixed sources, upstream cited sources and explicitly supplied attachments/calculations. */
export function reportMethodSources(composition: ReportComposition, method: ReportMethod, previous: ReportMethodRun[], sources: ReportSource[]) {
  const upstream = composition.snapshot.selection.graph.links.filter(link => link.toMethodId === method.ref.entryId).map(link => link.fromMethodId);
  const inherited = new Set(previous.filter(run => upstream.includes(run.methodRef.entryId)).flatMap(run => run.sourceIds));
  const own = composition.snapshot.reportReadBindings?.filter(binding => binding.methodId === method.ref.entryId) ?? [];
  return sources.filter(source => !source.connectionId || inherited.has(source.id) || own.some(binding => binding.connectionId === source.connectionId && binding.capabilityKey === source.capabilityKey && binding.authorityHash === source.authorityHash));
}

export function reportMethodOutputSchema(composition: ReportComposition, method: ReportMethod, sources: ReportSource[]) {
  const graph = composition.snapshot.selection.graph;
  const required = [...new Set([...graph.links.filter(link => link.fromMethodId === method.ref.entryId).map(link => link.outputField),
    ...graph.deliveries.filter(delivery => delivery.methodId === method.ref.entryId).map(delivery => delivery.outputField)])];
  const ids = sources.map(source => source.id), allowed = new Set(ids);
  return z.object({ outputs: valuesContract(method.manifest.output, required), sourceIds: z.array(z.string().min(1).max(100)).max(7) }).strict().superRefine((value, ctx) => {
    if (new Set(value.sourceIds).size !== value.sourceIds.length || value.sourceIds.some(id => !allowed.has(id)))
      ctx.addIssue({ code: 'custom', message: 'Source references must identify supplied sources exactly once' });
    for (const text of Object.values(value.outputs).filter(item => typeof item === 'string') as string[]) {
      if ([...text.matchAll(/\[((?:S|M)\d+)\]/g)].some(match => !allowed.has(match[1]) || !value.sourceIds.includes(match[1])))
        ctx.addIssue({ code: 'custom', message: 'Cited sources must be supplied and declared in sourceIds' });
      if ([...text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].some(match => !sources.some(source => source.url === match[1])))
        ctx.addIssue({ code: 'custom', message: 'A cited webpage link must be an actually supplied original' });
    }
  });
}
