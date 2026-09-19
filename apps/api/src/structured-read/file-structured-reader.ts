import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  fieldTypeOf, mapEnum, parseIsoDate, parseNumeric, validateStructuredField,
  type FieldExpectation, type JsonValue, type StructuredReadBlock, type StructuredReadEnvelope,
  type StructuredReadField,
} from '@lazy-armor/plan-schema';

/**
 * R6 Local File Structured Read.
 *
 * TXT / JSON / CSV / MD are parsed natively. PDF goes through a text-layer /
 * embedded-structure parser first and only falls back to Vision when the text
 * layer is empty or the layout cannot be recovered — a whole PDF is never
 * rendered to images by default. Images always fall back to Vision.
 *
 * fileHash / pageNumber / pageCount / extractionMethod are preserved as
 * provenance; page provenance is never dropped.
 */
export const PDF_TEXT_LAYER = Symbol('PDF_TEXT_LAYER');

export interface PdfTextLayer {
  extractText(content: Buffer): Promise<string | null>;
}

@Injectable()
export class NoopPdfTextLayer implements PdfTextLayer {
  async extractText(): Promise<string | null> { return null; }
}

export interface LocalFileReadInput {
  requestId: string;
  resourceType: string;
  resourceId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  requestedFields: string[];
  fieldExpectations?: Record<string, FieldExpectation>;
  fileHash: string;
  pageNumber?: number;
  pageCount?: number;
}

export interface LocalFileReadOutput {
  envelope: StructuredReadEnvelope | null;
  needsVisionFallback: boolean;
}

@Injectable()
export class LocalFileStructuredReadService {
  constructor(@Inject(PDF_TEXT_LAYER) private readonly pdf: PdfTextLayer) {}

  async read(input: LocalFileReadInput): Promise<LocalFileReadOutput> {
    const normalized = input.mimeType.toLowerCase();
    if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp' || normalized.startsWith('image/')) {
      return { envelope: null, needsVisionFallback: true };
    }
    if (normalized === 'application/pdf') {
      const text = await this.pdf.extractText(input.content);
      if (text === null || text.trim() === '') return { envelope: null, needsVisionFallback: true };
      const envelope = this.buildEnvelope(input, 'FILE_NATIVE', 'text-layer', [{ type: 'TEXT', text }], this.extractFromText(text, input));
      return { envelope, needsVisionFallback: false };
    }
    if (normalized === 'application/json' || normalized === 'text/json') return this.parseJson(input);
    if (normalized === 'text/csv' || normalized === 'application/csv') return this.parseCsv(input);
    if (normalized === 'text/markdown' || normalized === 'text/x-markdown' || normalized === 'text/md' || input.fileName.toLowerCase().endsWith('.md')) return this.parseMarkdown(input);
    if (normalized === 'text/plain' || normalized === 'text/txt' || input.fileName.toLowerCase().endsWith('.txt')) return this.parseText(input);
    return { envelope: null, needsVisionFallback: true };
  }

  private parseText(input: LocalFileReadInput): LocalFileReadOutput {
    const text = input.content.toString('utf8');
    const blocks: StructuredReadBlock[] = [{ type: 'TEXT', text }];
    const entries = parseKeyValueLines(text);
    if (entries.length) blocks.push({ type: 'KEY_VALUE', entries });
    return { envelope: this.buildEnvelope(input, 'FILE_NATIVE', 'text-native', blocks, this.extractFromEntries(entries, input)), needsVisionFallback: false };
  }

  private parseJson(input: LocalFileReadInput): LocalFileReadOutput {
    let parsed: unknown;
    try { parsed = JSON.parse(input.content.toString('utf8')); } catch { return { envelope: null, needsVisionFallback: true }; }
    const entries = flattenJson(parsed);
    const blocks: StructuredReadBlock[] = [{ type: 'KEY_VALUE', entries }];
    return { envelope: this.buildEnvelope(input, 'FILE_NATIVE', 'json-native', blocks, this.extractFromEntries(entries, input)), needsVisionFallback: false };
  }

  private parseCsv(input: LocalFileReadInput): LocalFileReadOutput {
    const rows = parseCsvRows(input.content.toString('utf8'));
    if (!rows.length) return { envelope: null, needsVisionFallback: true };
    const header = rows[0].map((cell) => String(cell ?? ''));
    const dataRows = rows.slice(1);
    const blocks: StructuredReadBlock[] = [{ type: 'TABLE', rows, columns: header }];
    const entries: Array<{ key: string; value: JsonValue }> = [];
    header.forEach((column, index) => {
      const values = dataRows.map((row) => row[index]).filter((value) => value !== undefined);
      entries.push({ key: column, value: values.length === 1 ? values[0] : values });
    });
    return { envelope: this.buildEnvelope(input, 'FILE_NATIVE', 'csv-native', blocks, this.extractFromEntries(entries, input)), needsVisionFallback: false };
  }

  private parseMarkdown(input: LocalFileReadInput): LocalFileReadOutput {
    const text = input.content.toString('utf8');
    const blocks: StructuredReadBlock[] = [];
    const listItems: string[] = [];
    const entries: Array<{ key: string; value: JsonValue }> = [];
    for (const line of text.split(/\r?\n/)) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (heading) { blocks.push({ type: 'HEADING', level: heading[1].length, text: heading[2] }); continue; }
      const listItem = /^[-*+]\s+(.+)$/.exec(line.trim());
      if (listItem) { listItems.push(listItem[1]); continue; }
      const pair = /^\*{0,2}([^:*]+?)\*{0,2}\s*[:：]\s*(.+)$/.exec(line.trim());
      if (pair) { entries.push({ key: pair[1].trim(), value: pair[2].trim() }); continue; }
      const plain = /^[A-Za-z_][A-Za-z0-9_.]*\s*[:：]\s*(.+)$/.exec(line.trim());
      if (plain) entries.push({ key: plain[1], value: plain[2].trim() });
    }
    if (listItems.length) blocks.push({ type: 'LIST', items: listItems });
    if (entries.length) blocks.push({ type: 'KEY_VALUE', entries });
    if (!blocks.length) blocks.push({ type: 'TEXT', text });
    return { envelope: this.buildEnvelope(input, 'FILE_NATIVE', 'markdown-native', blocks, this.extractFromEntries(entries, input)), needsVisionFallback: false };
  }

  private extractFromEntries(entries: Array<{ key: string; value: JsonValue }>, input: LocalFileReadInput): Array<Omit<StructuredReadField, 'validation'>> {
    const byKey = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
    return input.requestedFields.map((fieldName) => {
      const raw = byKey.get(fieldName.toLowerCase()) ?? byKey.get(fieldName);
      if (!raw) return missingField(fieldName, input.fieldExpectations?.[fieldName]);
      return normalizeField(fieldName, raw.value, input.fieldExpectations?.[fieldName]);
    });
  }

  private extractFromText(text: string, input: LocalFileReadInput): Array<Omit<StructuredReadField, 'validation'>> {
    const entries = parseKeyValueLines(text);
    return this.extractFromEntries(entries, input);
  }

  private buildEnvelope(
    input: LocalFileReadInput,
    method: 'FILE_NATIVE',
    extractionMethod: string,
    blocks: StructuredReadBlock[],
    fields: Array<Omit<StructuredReadField, 'validation'>>,
  ): StructuredReadEnvelope {
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const observedAt = new Date().toISOString();
    const sourceIdentity = `file:${input.fileHash}`;
    const resourceIdentity = `${input.resourceType}:${input.resourceId}`;
    const validated = fields.map((field) => validateStructuredField(field));
    const confidence = validated.length ? validated.reduce((sum, field) => sum + field.confidence, 0) / validated.length : 1;
    return {
      requestId: input.requestId, sourceType: 'FILE', resourceType: input.resourceType, resourceId: input.resourceId,
      readMethod: method, parserId: 'generic.structured-read.v1', parserVersion: 1, observedAt,
      contentHash, evidenceHash: createHash('sha256').update(contentHash + ':' + extractionMethod).digest('hex'),
      sourceIdentity, resourceIdentity, confidence, blocks, fields: validated, warnings: [],
      provenance: { fileHash: input.fileHash, pageNumber: input.pageNumber, pageCount: input.pageCount, extractionMethod },
    };
  }
}

export function parseKeyValueLines(text: string): Array<{ key: string; value: JsonValue }> {
  const entries: Array<{ key: string; value: JsonValue }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pair = /^([A-Za-z_][A-Za-z0-9_.\- ]*?)\s*[:：=]\s*(.+)$/.exec(trimmed);
    if (pair) entries.push({ key: pair[1].trim(), value: pair[2].trim() });
  }
  return entries;
}

export function flattenJson(value: unknown, prefix = ''): Array<{ key: string; value: JsonValue }> {
  if (Array.isArray(value)) return [{ key: prefix || 'items', value: value as JsonValue }];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flattenJson(item, prefix ? `${prefix}.${key}` : key));
  }
  return [{ key: prefix, value: value as JsonValue }];
}

export function parseCsvRows(text: string): JsonValue[][] {
  const rows: JsonValue[][] = [];
  let row: JsonValue[] = [];
  let cell = '';
  let quoted = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; };
  const pushRow = () => { pushCell(); if (row.length) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === ',' && !quoted) pushCell();
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index += 1; pushRow(); }
    else cell += char;
  }
  if (cell || row.length) pushRow();
  return rows;
}

export function missingField(fieldName: string, expectation?: FieldExpectation): Omit<StructuredReadField, 'validation'> {
  return { field: fieldName, rawText: '', normalizedValue: null, type: expectation?.type ?? 'string', confidence: 0, expectation };
}

export function normalizeField(fieldName: string, value: JsonValue, expectation?: FieldExpectation): Omit<StructuredReadField, 'validation'> {
  const text = typeof value === 'string' ? value : String(value ?? '');
  let normalizedValue: JsonValue | null;
  let type = expectation?.type ?? fieldTypeOf(value ?? '');
  if (type === 'number') normalizedValue = typeof value === 'number' ? value : parseNumeric(text);
  else if (type === 'date') normalizedValue = typeof value === 'string' ? parseIsoDate(value) : null;
  else if (type === 'enum') normalizedValue = mapEnum(text, expectation?.enum ?? []);
  else if (type === 'boolean') normalizedValue = typeof value === 'boolean' ? value : /^(true|yes|1)$/i.test(text) ? true : /^(false|no|0)$/i.test(text) ? false : null;
  else normalizedValue = typeof value === 'string' ? value : text;
  return { field: fieldName, rawText: text, normalizedValue, type, confidence: normalizedValue === null ? 0 : 1, expectation };
}
