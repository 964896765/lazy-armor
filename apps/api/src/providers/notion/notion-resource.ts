import { z } from 'zod';
import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

export const notionId = z.string().uuid();
const scalar = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), value: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('rich_text'), value: z.string().max(2000) }).strict(),
  z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('checkbox'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('date'), value: z.object({ start: z.string().datetime(), end: z.string().datetime().nullable().optional() }).strict() }).strict(),
  z.object({ type: z.literal('select'), value: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal('status'), value: z.string().min(1).max(100) }).strict(),
]);
const action = z.object({ parent: z.object({ type: z.enum(['page_id', 'data_source_id']), id: notionId }).strict(), pageId: notionId.optional(),
  properties: z.record(z.string().min(1).max(200), scalar).refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 32), expectedLastEditedTime: z.string().datetime().optional() }).strict();
export type NotionAction = z.infer<typeof action>;

export function prepareNotionAction(input: Record<string, unknown>, key: string | undefined, update: boolean) {
  const parsed = action.safeParse((input.context as Record<string, unknown> | undefined)?.notionAction);
  if (!parsed.success || !/^[a-f0-9]{64}$/.test(key ?? '') || (update !== Boolean(parsed.data.pageId))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  if (parsed.data.parent.type === 'page_id' && (Object.keys(parsed.data.properties).length !== 1 || !Object.values(parsed.data.properties).every((v) => v.type === 'title'))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
  return { ...parsed.data, operationKey: key! };
}
export function notionPropertyPayload(properties: NotionAction['properties']) {
  return Object.fromEntries(Object.entries(properties).map(([name, item]) => [name, item.type === 'title' || item.type === 'rich_text'
    ? { [item.type]: item.value ? [{ type: 'text', text: { content: item.value } }] : [] }
    : item.type === 'select' || item.type === 'status' ? { [item.type]: { name: item.value } }
    : { [item.type]: item.value }]));
}
export function normalizeNotionResource(raw: Record<string, unknown>, workspaceId: string, expectedId?: string) {
  const type = raw.object === 'page' ? 'Page' : raw.object === 'data_source' ? 'DataSource' : null;
  const id = notionId.safeParse(raw.id); const edited = typeof raw.last_edited_time === 'string' && Number.isFinite(Date.parse(raw.last_edited_time)) ? new Date(raw.last_edited_time).toISOString() : null;
  if (!type || !id.success || !edited || (expectedId && id.data !== expectedId) || !raw.properties || typeof raw.properties !== 'object' || Array.isArray(raw.properties)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const value = { resourceType: type, resourceId: id.data, workspaceId, parent: raw.parent ?? null, properties: raw.properties, updatedAt: edited };
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return value;
}
export function notionWriteEvidence(raw: Record<string, unknown>, desired: ReturnType<typeof prepareNotionAction>, workspaceId: string) {
  let normalized: ReturnType<typeof normalizeNotionResource> | null = null;
  try { normalized = normalizeNotionResource(raw, workspaceId, desired.pageId); } catch { /* mismatch */ }
  const expected = { parent: { type: desired.parent.type, [desired.parent.type]: desired.parent.id }, properties: notionPropertyPayload(desired.properties) };
  const actual = normalized ? { parent: normalized.parent, properties: Object.fromEntries(Object.entries(desired.properties).map(([key, item]) => {
    const raw = (normalized!.properties as Record<string, Record<string, unknown>>)[key]; return [key, raw && raw.type === item.type ? { [item.type]: raw[item.type] } : null]; })) } : null;
  return { matched: Boolean(normalized && providerDefinitionHash(actual) === providerDefinitionHash(expected)), resourceId: normalized?.resourceId ?? '',
    workspaceId, expectedHash: providerDefinitionHash(expected), actualHash: providerDefinitionHash(actual) };
}
