import { ProviderRuntimeError, providerDefinitionHash } from '@lazy-armor/connector-sdk';

function invalid(): never { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
export function operationMessageId(key: string | undefined) {
  if (!key || !/^[a-f0-9]{64}$/.test(key)) invalid();
  return `<lazy-armor-${key}@lazy-armor.invalid>`;
}
function address(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value)) invalid();
  return value.toLowerCase();
}
export function prepareMail(input: Record<string, unknown>, from: string, key: string | undefined) {
  const context = input.context as Record<string, unknown> | undefined;
  const email = context?.email as Record<string, unknown> | undefined;
  if (!email || !Array.isArray(email.to) || email.to.length < 1 || email.to.length > 20
    || typeof email.subject !== 'string' || /[\r\n\0]/.test(email.subject) || Buffer.byteLength(email.subject) > 512
    || typeof email.body !== 'string' || Buffer.byteLength(email.body) > 128 * 1024) invalid();
  const to = [...new Set(email.to.map(address))].sort(); const sender = address(email.from);
  if (sender !== address(from)) invalid();
  const messageId = operationMessageId(key); const body = email.body.replace(/\r?\n/g, '\n');
  const encoded = Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const mime = [`From: ${sender}`, `To: ${to.join(', ')}`, `Subject: =?UTF-8?B?${Buffer.from(email.subject).toString('base64')}?=`,
    `Message-ID: ${messageId}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded].join('\r\n');
  return { to, from: sender, subject: email.subject, body, rfcMessageId: messageId, raw: Buffer.from(mime).toString('base64url') };
}
export function normalizeMessage(raw: Record<string, unknown>, includeBody: boolean) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(raw.id)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  const payload = raw.payload as Record<string, unknown> | undefined;
  const headers = Array.isArray(payload?.headers) ? payload.headers.filter((h): h is { name: string; value: string } =>
    Boolean(h) && typeof h === 'object' && typeof h.name === 'string' && typeof h.value === 'string') : [];
  const header = (name: string) => headers.find((h) => typeof h.name === 'string' && h.name.toLowerCase() === name)?.value ?? '';
  const decodeHeader = (value: string) => value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b: string) => Buffer.from(b, 'base64').toString('utf8'));
  const bodies: string[] = []; let nodes = 0;
  function visit(part: Record<string, unknown>, depth: number) {
    if (++nodes > 128 || depth > 8) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    const body = part.body as Record<string, unknown> | undefined;
    // Attachments and HTML are not downloaded or mistaken for the approved plain-text body.
    if (part.mimeType === 'text/plain' && !part.filename && typeof body?.data === 'string') {
      if (body.data.length > 2 * 1024 * 1024) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
      bodies.push(Buffer.from(body.data, 'base64url').toString('utf8').replace(/\r?\n/g, '\n'));
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) if (child && typeof child === 'object') visit(child as Record<string, unknown>, depth + 1);
  }
  if (includeBody && payload) visit(payload, 0);
  const occurredAt = new Date(Number(raw.internalDate));
  if (!Number.isFinite(occurredAt.getTime())) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
  return { messageId: raw.id, threadId: typeof raw.threadId === 'string' ? raw.threadId : '', subject: decodeHeader(header('subject')),
    from: header('from'), to: header('to').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
    occurredAt: occurredAt.toISOString(), labels: Array.isArray(raw.labelIds) ? raw.labelIds.filter((x): x is string => typeof x === 'string') : [],
    rfcMessageId: header('message-id'), ...(includeBody ? { plainText: bodies.join('\n') } : {}) };
}
export function readbackEvidence(actual: ReturnType<typeof normalizeMessage>, desired: ReturnType<typeof prepareMail>, label: 'SENT' | 'DRAFT') {
  const matched = actual.rfcMessageId === desired.rfcMessageId && actual.subject === desired.subject
    && actual.from.trim().toLowerCase() === desired.from && JSON.stringify([...actual.to].sort()) === JSON.stringify(desired.to)
    && actual.plainText === desired.body && actual.labels.includes(label);
  return { matched, messageId: actual.messageId, expectedHash: providerDefinitionHash({ to: desired.to, from: desired.from, subject: desired.subject, body: desired.body }),
    actualHash: providerDefinitionHash({ to: [...actual.to].sort(), from: actual.from.trim().toLowerCase(), subject: actual.subject, body: actual.plainText }), label };
}
