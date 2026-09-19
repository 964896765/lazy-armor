import {
  parseIsoDate, parseNumeric, type JsonValue, type StructuredReadField, type StructuredReadFieldType,
  type StructuredReadRegion, type VisionReadInput, type VisualExtractionResult,
} from '@lazy-armor/plan-schema';

/**
 * Thin Vision boundary. The core read service only depends on this interface;
 * no vendor API is hard-coded. Vision output is structured (field/rawText/
 * normalizedValue/confidence/sourceRegion/warnings), never free text, and is
 * never written to Truth directly. Deterministic validation happens later.
 */
export const VISION_READ_ADAPTER = Symbol('VISION_READ_ADAPTER');

export interface VisionReadAdapter {
  extract(input: VisionReadInput): Promise<VisualExtractionResult>;
}

/** Programmable adapter for tests: supply any handler, including error paths. */
export class FakeVisionAdapter implements VisionReadAdapter {
  constructor(private readonly handler: (input: VisionReadInput) => VisualExtractionResult | Promise<VisualExtractionResult>) {}
  extract(input: VisionReadInput): Promise<VisualExtractionResult> {
    return Promise.resolve(this.handler(input));
  }
}

export function visionField(
  field: string,
  normalizedValue: JsonValue,
  type: StructuredReadFieldType,
  confidence: number,
  rawText: string,
  sourceRegion?: StructuredReadRegion,
): Omit<StructuredReadField, 'validation'> {
  return { field, rawText, normalizedValue, type, confidence, sourceRegion };
}

/**
 * Fixed fixture covering every required Vision scenario without any real model
 * or account. Keyed off `resourceId` so the golden reads stay deterministic.
 */
export class FixtureVisionAdapter implements VisionReadAdapter {
  async extract(input: VisionReadInput): Promise<VisualExtractionResult> {
    switch (input.resourceId) {
      case 'vision-correct': return { requestId: input.requestId, sourceRegion: { page: 1 }, warnings: [], fields: [
        visionField('totalAmount', 128.5, 'number', 0.97, '￥128.50', { page: 1 }),
        visionField('invoiceDate', parseIsoDate('2026-09-18')!, 'date', 0.95, '2026-09-18', { page: 1 }),
      ] };
      case 'vision-low-confidence': return { requestId: input.requestId, warnings: ['LOW_CONFIDENCE'], fields: [
        visionField('totalAmount', 42.0, 'number', 0.42, '42?', { page: 1 }),
      ] };
      case 'vision-schema-invalid': return { requestId: input.requestId, warnings: ['SCHEMA_INVALID'], fields: [
        visionField('totalAmount', 'not-a-number', 'number', 0.9, 'N/A', { page: 1 }),
      ] };
      case 'vision-missing-field': return { requestId: input.requestId, warnings: ['MISSING_FIELD'], fields: [] };
      case 'vision-ambiguous': return { requestId: input.requestId, warnings: ['AMBIGUOUS'], fields: [
        visionField('totalAmount', 100, 'number', 0.55, '100 or 1000', { page: 1 }),
        visionField('totalAmount', 1000, 'number', 0.55, '100 or 1000', { page: 1 }),
      ] };
      case 'vision-wrong-resource': return { requestId: input.requestId, warnings: ['WRONG_RESOURCE'], fields: [
        visionField('totalAmount', parseNumeric('9.99')!, 'number', 0.99, '9.99', { page: 1 }),
      ] };
      case 'vision-duplicate': return { requestId: input.requestId, warnings: ['DUPLICATE'], fields: [
        visionField('totalAmount', 7.5, 'number', 0.98, '7.50', { page: 1 }),
        visionField('totalAmount', 7.5, 'number', 0.98, '7.50', { page: 1 }),
      ] };
      case 'vision-stale': return { requestId: input.requestId, warnings: ['STALE_CAPTURE'], fields: [
        visionField('totalAmount', 11.0, 'number', 0.98, '11.00', { page: 1 }),
      ] };
      case 'vision-hash-mismatch': return { requestId: input.requestId, warnings: ['HASH_MISMATCH'], fields: [
        visionField('totalAmount', 22.0, 'number', 0.98, '22.00', { page: 1 }),
      ] };
      default: return { requestId: input.requestId, warnings: ['UNKNOWN_VISION_FIXTURE'], fields: [] };
    }
  }
}
