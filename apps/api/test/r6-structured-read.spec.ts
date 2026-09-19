import { describe, expect, it } from 'vitest';
import {
  assertAppReadProfile, canonicalRecords, mapEnum, parseIsoDate, parseNumeric,
  parseAndNormalizeObservation, redactSensitiveFields, SECURITY_BLOCKED_FIELD, validateStructuredField,
  type AppReadProfile, type StructuredReadField,
} from '@lazy-armor/plan-schema';
import { FixtureVisionAdapter, FakeVisionAdapter, visionField } from '../src/structured-read/vision-adapter';
import { LocalFileStructuredReadService, NoopPdfTextLayer, normalizeField, parseCsvRows, parseKeyValueLines } from '../src/structured-read/file-structured-reader';
import { resolveAppReadProfile } from '../src/structured-read/app-read-profiles';

const rawField = (overrides: Partial<Omit<StructuredReadField, 'validation'>> = {}): Omit<StructuredReadField, 'validation'> => ({
  field: 'totalAmount', rawText: '128.50', normalizedValue: 128.5, type: 'number', confidence: 0.97, ...overrides,
});

describe('R6 deterministic validation and sensitive field redaction', () => {
  it('accepts a high-confidence numeric field as VALID', () => {
    expect(validateStructuredField(rawField())).toMatchObject({ validation: { status: 'VALID', errors: [] } });
  });
  it('maps low confidence to NEEDS_CONFIRMATION, never VERIFIED', () => {
    expect(validateStructuredField(rawField({ confidence: 0.4 })).validation.status).toBe('NEEDS_CONFIRMATION');
  });
  it('rejects schema/type/range/enum violations as EXTRACTION_INVALID', () => {
    expect(validateStructuredField(rawField({ normalizedValue: 'not-a-number' })).validation.status).toBe('EXTRACTION_INVALID');
    expect(validateStructuredField(rawField({ expectation: { min: 0, max: 100 } })).validation.status).toBe('EXTRACTION_INVALID');
    expect(validateStructuredField({ field: 'state', rawText: 'weird', normalizedValue: 'weird', type: 'enum', confidence: 0.99, expectation: { enum: ['OPEN', 'CLOSED'] } }).validation.status).toBe('EXTRACTION_INVALID');
  });
  it('parses numbers, dates and enums deterministically', () => {
    expect(parseNumeric('1,234.50')).toBe(1234.5);
    expect(parseNumeric('N/A')).toBeNull();
    expect(parseIsoDate('20260918')).toBe('2026-09-18T00:00:00.000Z');
    expect(mapEnum('open', ['OPEN', 'CLOSED'])).toBe('OPEN');
    expect(mapEnum('unknown', ['OPEN', 'CLOSED'])).toBeNull();
  });
  it('redacts sensitive fields and marks them SECURITY_BLOCKED_FIELD', () => {
    const fields = redactSensitiveFields([validateStructuredField({ field: 'paymentPassword', rawText: 'secret', normalizedValue: 'secret', type: 'string', confidence: 1 })]);
    expect(fields[0]).toMatchObject({ redacted: true, normalizedValue: null, confidence: 0, validation: { status: 'EXTRACTION_INVALID', errors: [SECURITY_BLOCKED_FIELD] } });
  });
  it('forbids wildcard selectors, empty selectors and fact/block overlap in App Read Profiles', () => {
    expect(() => assertAppReadProfile({ packageName: 'com.a.b', profileKey: 'p', resourceType: 'R', factKeys: ['a'], allowedSelectors: ['*'], requiredForeground: true, sensitiveFields: [], blockedFields: [], parserId: 'generic.structured-read.v1', verificationPolicy: 'STRUCTURED_ONLY' })).toThrow(/Wildcard/);
    expect(() => assertAppReadProfile({ packageName: 'com.a.b', profileKey: 'p', resourceType: 'R', factKeys: ['password'], allowedSelectors: ['a'], requiredForeground: true, sensitiveFields: ['password'], blockedFields: ['password'], parserId: 'generic.structured-read.v1', verificationPolicy: 'STRUCTURED_ONLY' })).toThrow(/overlap/);
    expect(() => resolveAppReadProfile('com.lazyarmor.fixture.wallet')).not.toThrow();
  });
  it('parses a structured-read observation into per-field facts', () => {
    const observation = {
      sourceMode: 'FILE' as const, providerKey: 'local-file', connectionId: null,
      externalEventKey: 'structured-read:req', parserKey: 'generic.structured-read.v1' as const, resourceHint: 'FixtureWallet',
      payload: { resourceType: 'FixtureWallet', resourceId: 'wallet-1', sourceIdentity: 'file:abc', readMethod: 'FILE_NATIVE', observedAt: '2026-09-19T00:00:00.000Z', resourceVersion: '2026-09-19T00:00:00.000Z',
        fields: [{ field: 'balance', normalizedValue: 128.5, type: 'number', confidence: 0.99, validation: { status: 'VALID', errors: [] } }] },
      evidenceHash: 'a'.repeat(64), observedAt: '2026-09-19T00:00:00.000Z',
    };
    const facts = parseAndNormalizeObservation(observation);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ resourceType: 'StructuredRead', factKey: 'structured_read.field', subjectKey: expect.stringContaining(':balance') });
  });
  it('rejects EXTRACTION_INVALID fields at the parser boundary', () => {
    const observation = {
      sourceMode: 'FILE' as const, providerKey: 'local-file', connectionId: null,
      externalEventKey: 'structured-read:req2', parserKey: 'generic.structured-read.v1' as const, resourceHint: 'FixtureWallet',
      payload: { resourceType: 'FixtureWallet', resourceId: 'wallet-1', sourceIdentity: 'file:abc', readMethod: 'FILE_NATIVE', observedAt: '2026-09-19T00:00:00.000Z',
        fields: [{ field: 'balance', normalizedValue: 'bad', type: 'number', confidence: 0.99, validation: { status: 'EXTRACTION_INVALID', errors: ['x'] } }] },
      evidenceHash: 'b'.repeat(64), observedAt: '2026-09-19T00:00:00.000Z',
    };
    expect(() => parseAndNormalizeObservation(observation)).toThrow();
  });
});

describe('R6 Vision adapter fixtures', () => {
  it('covers high-confidence correct, low confidence, schema invalid and missing field', async () => {
    const adapter = new FixtureVisionAdapter();
    const correct = await adapter.extract({ requestId: 'r', resourceType: 'Image', resourceId: 'vision-correct', requestedFields: ['totalAmount'], imageHash: 'h', mediaKind: 'image' });
    expect(correct.fields).toHaveLength(2);
    expect(correct.fields[0]).toMatchObject({ field: 'totalAmount', normalizedValue: 128.5, confidence: 0.97 });
    const low = await adapter.extract({ requestId: 'r', resourceType: 'Image', resourceId: 'vision-low-confidence', requestedFields: ['totalAmount'], imageHash: 'h', mediaKind: 'image' });
    expect(validateStructuredField(low.fields[0]).validation.status).toBe('NEEDS_CONFIRMATION');
    const invalid = await adapter.extract({ requestId: 'r', resourceType: 'Image', resourceId: 'vision-schema-invalid', requestedFields: ['totalAmount'], imageHash: 'h', mediaKind: 'image' });
    expect(validateStructuredField(invalid.fields[0]).validation.status).toBe('EXTRACTION_INVALID');
    const missing = await adapter.extract({ requestId: 'r', resourceType: 'Image', resourceId: 'vision-missing-field', requestedFields: ['totalAmount'], imageHash: 'h', mediaKind: 'image' });
    expect(missing.fields).toHaveLength(0);
  });
  it('FakeVisionAdapter delegates to the injected handler', async () => {
    const adapter = new FakeVisionAdapter((input) => ({ requestId: input.requestId, warnings: [], fields: [visionField('x', 1, 'number', 0.9, '1')] }));
    expect((await adapter.extract({ requestId: 'r', resourceType: 'Image', resourceId: 'any', requestedFields: [], imageHash: 'h', mediaKind: 'image' })).fields).toHaveLength(1);
  });
});

describe('R6 local file structured read', () => {
  const service = new LocalFileStructuredReadService(new NoopPdfTextLayer());

  it('parses JSON into validated fields', async () => {
    const output = await service.read({ requestId: 'r', resourceType: 'JsonDoc', resourceId: 'j', fileName: 'a.json', mimeType: 'application/json', content: Buffer.from(JSON.stringify({ balance: 99.5, dueDate: '2026-09-19' })), requestedFields: ['balance', 'dueDate'], fieldExpectations: { balance: { type: 'number' }, dueDate: { type: 'date' } }, fileHash: 'f'.repeat(64) });
    expect(output.needsVisionFallback).toBe(false);
    expect(output.envelope!.fields.map((f) => f.field)).toEqual(['balance', 'dueDate']);
    expect(output.envelope!.fields[0]).toMatchObject({ normalizedValue: 99.5, validation: { status: 'VALID' } });
  });
  it('parses CSV into a canonical table', async () => {
    const output = await service.read({ requestId: 'r', resourceType: 'CsvDoc', resourceId: 'c', fileName: 'a.csv', mimeType: 'text/csv', content: Buffer.from('name,amount\nAlice,10'), requestedFields: ['amount'], fieldExpectations: { amount: { type: 'number' } }, fileHash: 'e'.repeat(64) });
    const table = output.envelope!.blocks.find((block) => block.type === 'TABLE');
    expect(table).toMatchObject({ columns: ['name', 'amount'] });
    expect(output.envelope!.fields[0].normalizedValue).toEqual(10);
  });
  it('falls back to Vision for images and empty PDF text layers', async () => {
    const image = await service.read({ requestId: 'r', resourceType: 'Image', resourceId: 'i', fileName: 'a.png', mimeType: 'image/png', content: Buffer.from('x'), requestedFields: [], fileHash: 'd'.repeat(64) });
    expect(image.needsVisionFallback).toBe(true);
    const pdf = await service.read({ requestId: 'r', resourceType: 'PdfDoc', resourceId: 'p', fileName: 'a.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF'), requestedFields: [], fileHash: 'c'.repeat(64) });
    expect(pdf.needsVisionFallback).toBe(true);
  });
  it('normalizes fields and parses key-value lines and CSV rows', () => {
    expect(normalizeField('amount', '42.5', { type: 'number' })).toMatchObject({ normalizedValue: 42.5 });
    expect(parseKeyValueLines('balance: 100\nnote = hello')).toEqual([{ key: 'balance', value: '100' }, { key: 'note', value: 'hello' }]);
    expect(parseCsvRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
