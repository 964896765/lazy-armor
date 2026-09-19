import type { JsonValue } from './index';

/**
 * R6 Controlled Structured Read / Vision.
 *
 * Structured Read and Vision are Source Acquisition / Parsing adapters only.
 * They never build a second Truth Engine or Reality Pipeline. Every read
 * produces a `StructuredReadEnvelope` (blocks + validated fields) that is routed
 * through the existing Reality Pipeline: Observation -> Candidate -> Truth.
 *
 * Vision is a fallback that only produces extraction evidence. It never writes
 * Truth directly and never performs actions (no CLICK/TYPE/PAY/DELETE/CONFIRM/
 * SUBMIT). Vision output must pass deterministic validation (schema/type/range/
 * enum); confidence alone is never the basis for Truth.
 */

export const STRUCTURED_READ_SOURCES = ['PROVIDER', 'FILE', 'DEVICE_APP', 'IMAGE', 'PDF_PAGE'] as const;
export type StructuredReadSource = typeof STRUCTURED_READ_SOURCES[number];

export const STRUCTURED_READ_METHODS = ['PROVIDER_STRUCTURED', 'FILE_NATIVE', 'ANDROID_STRUCTURED', 'VISION_FALLBACK'] as const;
export type StructuredReadMethod = typeof STRUCTURED_READ_METHODS[number];

export const STRUCTURED_READ_BLOCK_TYPES = ['TEXT', 'HEADING', 'LIST', 'KEY_VALUE', 'TABLE', 'FIELD', 'LINK', 'METADATA', 'UI_NODE'] as const;
export type StructuredReadBlockType = typeof STRUCTURED_READ_BLOCK_TYPES[number];

export const READ_EVIDENCE_STATUSES = [
  'CAPTURED', 'STRUCTURED_READ', 'VISION_FALLBACK', 'NORMALIZED', 'CANDIDATE_CREATED', 'TRUTH_VERIFIED', 'NEEDS_CONFIRMATION', 'BLOCKED', 'REJECTED',
] as const;
export type ReadEvidenceStatus = typeof READ_EVIDENCE_STATUSES[number];

export const STRUCTURED_READ_PARSER = 'generic.structured-read.v1' as const;

/** One documented page / screen region where a field was observed. */
export interface StructuredReadRegion {
  page?: number;
  screen?: string;
  bounds?: { left: number; top: number; right: number; bottom: number };
}

export interface UiNode {
  text?: string;
  contentDescription?: string;
  role?: string;
  bounds?: { left: number; top: number; right: number; bottom: number };
  enabled?: boolean;
  selected?: boolean;
  resourceId?: string;
}

export interface UiNodeBlock {
  type: 'UI_NODE';
  screenId?: string;
  packageName?: string;
  activityName?: string;
  nodes: UiNode[];
}

export interface TextBlock { type: 'TEXT'; text: string; }
export interface HeadingBlock { type: 'HEADING'; level: number; text: string; }
export interface ListBlock { type: 'LIST'; items: string[]; ordered?: boolean; }
export interface KeyValueBlock { type: 'KEY_VALUE'; entries: Array<{ key: string; value: JsonValue }>; }
export interface LinkBlock { type: 'LINK'; text: string; href?: string; }
export interface MetadataBlock { type: 'METADATA'; key: string; value: JsonValue; }

export interface TableCell { value: JsonValue; row: number; column: number; }
export interface TableBlock {
  type: 'TABLE';
  sheet?: string;
  range?: string;
  rows: JsonValue[][];
  columns?: string[];
  cells?: TableCell[];
  headerMapping?: Record<string, string>;
}

export interface FieldBlock {
  type: 'FIELD';
  field: string;
  rawText: string;
  normalizedValue: JsonValue | null;
  confidence: number;
  sourceRegion?: StructuredReadRegion;
  warnings?: string[];
}

export type StructuredReadBlock =
  | TextBlock | HeadingBlock | ListBlock | KeyValueBlock | LinkBlock | MetadataBlock
  | TableBlock | FieldBlock | UiNodeBlock;

export type StructuredReadFieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';
export type FieldValidationStatus = 'VALID' | 'EXTRACTION_INVALID' | 'NEEDS_CONFIRMATION';

export interface FieldExpectation {
  type?: StructuredReadFieldType;
  enum?: readonly string[];
  min?: number;
  max?: number;
}

/** One business fact extracted from a structured read, before Truth materialization. */
export interface StructuredReadField {
  field: string;
  rawText: string;
  normalizedValue: JsonValue | null;
  type: StructuredReadFieldType;
  confidence: number;
  sourceRegion?: StructuredReadRegion;
  expectation?: FieldExpectation;
  validation: { status: FieldValidationStatus; errors: string[] };
  redacted?: boolean;
}

/** Provenance retained from the origin so old versions never overwrite newer Truth. */
export interface StructuredReadProvenance {
  documentId?: string;
  sheetId?: string;
  recordId?: string;
  revision?: string;
  version?: string;
  resourceVersion?: string;
  fileHash?: string;
  pageNumber?: number;
  pageCount?: number;
  extractionMethod?: string;
}

export interface StructuredReadRequest {
  requestId: string;
  userId: string;
  sourceType: StructuredReadSource;
  resourceType: string;
  resourceId: string;
  providerKey?: string | null;
  connectionId?: string | null;
  deviceId?: string | null;
  packageName?: string | null;
  appReadSessionId?: string | null;
  pageRange?: { from: number; to: number } | null;
  structuredSelector?: string | null;
  resourceHint?: string | null;
  requestedFields: string[];
  fieldExpectations?: Record<string, FieldExpectation>;
}

export interface StructuredReadEnvelope {
  requestId: string;
  sourceType: StructuredReadSource;
  resourceType: string;
  resourceId: string;
  readMethod: StructuredReadMethod;
  parserId: string;
  parserVersion: number;
  observedAt: string;
  contentHash: string;
  evidenceHash: string;
  sourceIdentity: string;
  resourceIdentity: string;
  resourceVersion?: string | null;
  confidence: number;
  blocks: StructuredReadBlock[];
  fields: StructuredReadField[];
  warnings: string[];
  provenance?: StructuredReadProvenance;
}

export interface StructuredReadEvidence {
  requestId: string;
  sourceType: StructuredReadSource;
  resourceType: string;
  resourceId: string;
  readMethod: StructuredReadMethod;
  parserId: string;
  contentHash: string;
  evidenceHash: string;
  sourceIdentity: string;
  resourceIdentity: string;
  observedAt: string;
  confidence: number;
  warnings: string[];
  status: ReadEvidenceStatus;
}

export interface StructuredReadResult {
  requestId: string;
  status: 'VERIFIED' | 'NEEDS_CONFIRMATION' | 'BLOCKED' | 'AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE';
  readMethod: StructuredReadMethod;
  fields: StructuredReadField[];
  observationId?: string | null;
  candidateIds: string[];
  truthRecordIds: string[];
  evidenceId?: string | null;
  acceptance: Record<string, string>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Deterministic validation. Vision/structured extractions are only accepted
// into Truth after passing schema/type/range/enum validation. Low confidence
// maps to NEEDS_CONFIRMATION, never VERIFIED.
// ---------------------------------------------------------------------------

const MIN_CONFIDENCE = 0.8;

export function parseNumeric(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parseIsoDate(text: string): string | null {
  const trimmed = text.trim();
  const normalized = /^\d{8}$/.test(trimmed)
    ? `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
    : trimmed;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function mapEnum(text: string, allowed: readonly string[]): string | null {
  const normalized = text.trim();
  const match = allowed.find((candidate) => candidate.toLowerCase() === normalized.toLowerCase());
  return match ?? null;
}

export function fieldTypeOf(value: JsonValue): StructuredReadFieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'string';
  return 'string';
}

/**
 * Applies deterministic validation to one extracted field. A field that fails
 * schema/type/range/enum validation becomes EXTRACTION_INVALID; a field that
 * validates but carries low confidence becomes NEEDS_CONFIRMATION.
 */
export function validateStructuredField(field: Omit<StructuredReadField, 'validation'>): StructuredReadField {
  const errors: string[] = [];
  const expectation = field.expectation;
  const type = field.type;
  if (expectation?.type && expectation.type !== type) errors.push(`expected type ${expectation.type}, got ${type}`);
  if (type === 'number') {
    if (typeof field.normalizedValue !== 'number' || !Number.isFinite(field.normalizedValue)) errors.push('normalizedValue is not a finite number');
    else if (expectation?.min !== undefined && field.normalizedValue < expectation.min) errors.push(`value below minimum ${expectation.min}`);
    else if (expectation?.max !== undefined && field.normalizedValue > expectation.max) errors.push(`value above maximum ${expectation.max}`);
  } else if (type === 'date') {
    if (typeof field.normalizedValue !== 'string' || !Number.isFinite(Date.parse(field.normalizedValue))) errors.push('normalizedValue is not a valid date');
  } else if (type === 'boolean') {
    if (typeof field.normalizedValue !== 'boolean') errors.push('normalizedValue is not a boolean');
  } else if (type === 'enum') {
    if (expectation?.enum && (typeof field.normalizedValue !== 'string' || !expectation.enum.includes(field.normalizedValue))) errors.push('normalizedValue is outside the allowed enum');
  } else if (typeof field.normalizedValue !== 'string' && field.normalizedValue !== null) {
    errors.push('string field requires a string normalizedValue');
  }
  const status: FieldValidationStatus = errors.length > 0 ? 'EXTRACTION_INVALID' : field.confidence < MIN_CONFIDENCE ? 'NEEDS_CONFIRMATION' : 'VALID';
  return { ...field, validation: { status, errors } };
}

// ---------------------------------------------------------------------------
// Sensitive field redaction. Sensitive values never enter raw payload, logs,
// audit or the Vision prompt; they are replaced with a REDACT marker and the
// field is blocked from Truth.
// ---------------------------------------------------------------------------

export const SENSITIVE_FIELD_PATTERN =
  /password|passwd|pwd|pin|otp|sms|verification[-_\s]?code|payment[-_\s]?password|pay[-_\s]?password|cvv|card[-_\s]?code|private[-_\s]?key|recovery[-_\s]?(phrase|key|code)|seed[-_\s]?phrase|security[-_\s]?answer|secret|access[-_\s]?token|refresh[-_\s]?token|session[-_\s]?cookie|authorization|credential/i;

export const SECURITY_BLOCKED_FIELD = 'SECURITY_BLOCKED_FIELD';
export const REDACTED_VALUE = '[REDACTED]';

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(field);
}

export function redactSensitiveFields(fields: StructuredReadField[]): StructuredReadField[] {
  return fields.map((field) => isSensitiveField(field.field)
    ? {
      ...field,
      normalizedValue: null,
      rawText: REDACTED_VALUE,
      confidence: 0,
      redacted: true,
      validation: { status: 'EXTRACTION_INVALID', errors: [SECURITY_BLOCKED_FIELD] },
    }
    : field);
}

// ---------------------------------------------------------------------------
// Canonical table shape shared by Feishu Sheet/Bitable, CSV and PDF tables.
// ---------------------------------------------------------------------------

export function canonicalTable(rows: JsonValue[][], columns?: string[]): TableBlock {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const resolvedColumns = columns ?? Array.from({ length: columnCount }, (_, index) => String.fromCharCode(65 + (index % 26)));
  const cells: TableCell[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (columnIndex >= resolvedColumns.length) return;
      cells.push({ value, row: rowIndex, column: columnIndex });
    });
  });
  return { type: 'TABLE', rows, columns: resolvedColumns, cells, headerMapping: Object.fromEntries(resolvedColumns.map((column, index) => [column, column])) };
}

/** Builds a canonical table from an array of record objects (Bitable/JSON rows). */
export function canonicalRecords(records: Array<Record<string, JsonValue>>): TableBlock {
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const rows = records.map((record) => columns.map((column) => record[column] ?? null));
  return canonicalTable(rows, columns);
}

// ---------------------------------------------------------------------------
// App Read Profile. Declares what a controlled Android read may read; it never
// grants anything on its own. `*` selectors and full-screen/all-text dumps are
// forbidden.
// ---------------------------------------------------------------------------

export interface AppReadProfile {
  packageName: string;
  profileKey: string;
  resourceType: string;
  factKeys: readonly string[];
  allowedSelectors: readonly string[];
  requiredForeground: boolean;
  sensitiveFields: readonly string[];
  blockedFields: readonly string[];
  parserId: string;
  verificationPolicy: 'STRUCTURED_ONLY' | 'STRUCTURED_THEN_VISION' | 'STRUCTURED_WITH_SCREEN_CAPTURE_FALLBACK';
}

export const WILDCARD_SELECTOR = '*';

export function assertAppReadProfile(profile: AppReadProfile): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(profile.packageName)) throw new Error('AppReadProfile requires an exact Android package');
  if (!profile.factKeys.length || !profile.allowedSelectors.length) throw new Error('AppReadProfile requires explicit factKeys and allowedSelectors');
  if (profile.allowedSelectors.includes(WILDCARD_SELECTOR)) throw new Error('Wildcard selector is forbidden');
  if (profile.allowedSelectors.some((selector) => selector.trim() === '')) throw new Error('Empty selector is forbidden');
  if (profile.sensitiveFields.some((field) => !isSensitiveField(field))) throw new Error('sensitiveFields must match the sensitive field pattern');
  if (profile.factKeys.some((key) => profile.blockedFields.includes(key))) throw new Error('factKeys must not overlap blockedFields');
}

/** Vision contract shared between the adapter boundary and the core read service. */
export interface VisionReadInput {
  requestId: string;
  resourceType: string;
  resourceId: string;
  requestedFields: string[];
  fieldExpectations?: Record<string, FieldExpectation>;
  imageHash: string;
  /** MIME type or capture kind; images only, never raw document text. */
  mediaKind: 'image' | 'screen_capture';
  pageNumber?: number;
  screenId?: string;
}

export interface VisualExtractionResult {
  requestId: string;
  fields: Omit<StructuredReadField, 'validation'>[];
  warnings: string[];
  sourceRegion?: StructuredReadRegion;
}
