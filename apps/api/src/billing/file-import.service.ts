import { createHash } from 'crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { billingRecords, fileImports } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import type { ImportBillingFileDto } from './dto';
import { UsageService } from '../usage/usage.service';

interface ParsedBillingRow {
  provider: string;
  category: string;
  billingPeriod: string;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
}

interface ParsedTransactionRow {
  accountKey: string | null;
  transactionId: string | null;
  relatedTransactionId: string | null;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  direction: 'DEBIT' | 'CREDIT' | null;
  transactionState: 'POSTED' | 'PENDING' | 'REFUND' | 'REVERSAL' | null;
  occurredAt: Date;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_RECORDS = 500;

@Injectable()
export class FileImportService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly pipeline: RealityPipelineService,
  ) {}

  async importBillingFile(userId: string, input: ImportBillingFileDto) {
    const existing = await this.findByIdempotency(userId, input.idempotencyKey);
    if (existing) return { ...this.toResponse(existing), duplicate: true };
    const content = Buffer.from(input.contentBase64, 'base64');
    if (content.length === 0 || content.length > MAX_FILE_BYTES) throw new BadRequestException('File must be between 1 byte and 1 MB');
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    const rows = this.parse(content.toString('utf8'), input.mimeType);
    if (rows.length === 0) throw new BadRequestException('File contains no billing records');
    if (rows.length > MAX_RECORDS) throw new BadRequestException(`File exceeds ${MAX_RECORDS} billing records`);
    const importId = newId();
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(fileImports).values({
          id: importId, userId, providerKey: 'local_file', idempotencyKey: input.idempotencyKey,
          fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, contentSha256,
          status: 'processing', recordCount: 0, errorCode: null, createdAt: now, processedAt: null,
        });
        for (const [index, row] of rows.entries()) {
          await tx.insert(billingRecords).values({
            id: newId(), userId, provider: row.provider, category: row.category, billingPeriod: row.billingPeriod,
            amountMinor: row.amountMinor, currency: row.currency, occurredAt: row.occurredAt, sourceType: 'file',
            metadataJson: { fileImportId: importId, rowNumber: index + 1, contentSha256 }, createdAt: now, updatedAt: now,
          });
        }
        await tx.update(fileImports).set({ status: 'completed', recordCount: rows.length, processedAt: now }).where(eq(fileImports.id, importId));
        await this.audit.append({
          actorType: 'user', actorUserId: userId, action: 'BILLING_FILE_IMPORTED', resourceType: 'file_import', resourceId: importId,
          userId, correlationId: importId, source: 'api', result: 'success',
          changeSummary: `Imported ${rows.length} billing records from local file metadata`,
          after: { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, contentSha256, recordCount: rows.length },
        }, tx);
        await this.usage.record({
          userId,
          usageType: 'storage.file_bytes',
          quantity: content.length,
          unit: 'bytes',
          provider: 'local_file',
          resourceType: 'file_import',
          resourceId: importId,
          usageIdentity: 'storage.file_bytes:' + importId,
          billable: true,
        }, tx);
      });
    } catch (error) {
      const raced = await this.findByIdempotency(userId, input.idempotencyKey);
      if (raced) return { ...this.toResponse(raced), duplicate: true };
      throw error;
    }
    return { ...this.toResponse((await this.findById(userId, importId))!), duplicate: false };
  }

  async list(userId: string) {
    const rows = await this.db.select().from(fileImports).where(eq(fileImports.userId, userId)).orderBy(desc(fileImports.createdAt)).limit(100);
    return rows.map((row) => this.toResponse(row));
  }

  /**
   * 交易文件导入：把文件行当作「候选事实」进入 Reality Pipeline
   * （Observation → Candidate），绝不直接落为可信 billing_records。
   * 每行绑定文件哈希、导入批次、行号与 parser 版本作为证据链。
   */
  async importTransactionFile(userId: string, input: ImportBillingFileDto) {
    const existing = await this.findByIdempotency(userId, input.idempotencyKey);
    if (existing) return { ...this.toResponse(existing), duplicate: true };
    const content = Buffer.from(input.contentBase64, 'base64');
    if (content.length === 0 || content.length > MAX_FILE_BYTES) throw new BadRequestException('File must be between 1 byte and 1 MB');
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    const { entries, failedRows: parseFailedRows } = this.parseTransactionRows(content.toString('utf8'), input.mimeType);
    const totalCount = entries.length + parseFailedRows.length;
    if (totalCount === 0) throw new BadRequestException('File contains no transaction records');
    if (entries.length === 0) throw new BadRequestException('File contains no valid transaction records');
    if (totalCount > MAX_RECORDS) throw new BadRequestException(`File exceeds ${MAX_RECORDS} records`);
    const importId = newId();
    const now = new Date();
    await this.db.insert(fileImports).values({
      id: importId, userId, providerKey: 'local_file', idempotencyKey: input.idempotencyKey,
      fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, contentSha256,
      status: 'processing', recordCount: 0, errorCode: null, createdAt: now, processedAt: null,
    });
    const candidates: unknown[] = [];
    const failedRows: number[] = [...parseFailedRows];
    for (const { row, rowNumber } of entries) {
      try {
        const result = await this.pipeline.ingest(userId, {
          sourceMode: 'FILE',
          providerKey: 'local_file',
          externalEventKey: `file-import:${importId}:${rowNumber}`,
          parserKey: 'generic.transaction.v1',
          resourceHint: 'finance.transaction',
          payload: {
            ...(row.accountKey ? { accountKey: row.accountKey } : {}),
            ...(row.transactionId ? { transactionId: row.transactionId } : {}),
            ...(row.relatedTransactionId ? { relatedTransactionId: row.relatedTransactionId } : {}),
            amountMinor: row.amountMinor,
            currency: row.currency,
            ...(row.merchant ? { merchant: row.merchant } : {}),
            ...(row.direction ? { direction: row.direction } : {}),
            ...(row.transactionState ? { transactionState: row.transactionState } : {}),
          },
          evidenceHash: contentSha256,
          observedAt: row.occurredAt.toISOString(),
          occurredAt: row.occurredAt.toISOString(),
        });
        candidates.push({ rowNumber, ...result });
      } catch {
        // 单行解析/归一化失败不阻断整批；失败行记录为 partial failure。
        failedRows.push(rowNumber);
      }
    }
    await this.db.update(fileImports).set({
      status: failedRows.length === 0 ? 'completed' : 'completed_with_errors',
      recordCount: totalCount, processedAt: now,
    }).where(eq(fileImports.id, importId));
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRANSACTION_FILE_IMPORTED', resourceType: 'file_import', resourceId: importId,
      userId, correlationId: importId, source: 'api', result: failedRows.length === 0 ? 'success' : 'failure',
      changeSummary: `Imported ${totalCount} transaction candidates (${failedRows.length} rows failed)`,
      after: { fileName: input.fileName, contentSha256, recordCount: totalCount, failedRows },
    });
    return { ...this.toResponse((await this.findById(userId, importId))!), duplicate: false, candidateCount: candidates.length, failedRows };
  }

  private parseTransactionRows(text: string, mimeType: ImportBillingFileDto['mimeType']): { entries: Array<{ row: ParsedTransactionRow; rowNumber: number }>; failedRows: number[] } {
    let rawRows: unknown[];
    if (mimeType === 'application/json') {
      try {
        const value = JSON.parse(text) as unknown;
        rawRows = Array.isArray(value) ? value : this.object(value).records as unknown[];
      } catch {
        throw new BadRequestException('JSON file is invalid');
      }
      if (!Array.isArray(rawRows)) throw new BadRequestException('JSON file must contain a records array');
    } else {
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return { entries: [], failedRows: [] };
      const headers = this.csvLine(lines[0]).map((header) => header.trim());
      rawRows = lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, this.csvLine(line)[index] ?? ''])));
    }
    const entries: Array<{ row: ParsedTransactionRow; rowNumber: number }> = [];
    const failedRows: number[] = [];
    rawRows.forEach((raw, index) => {
      const rowNumber = index + 1;
      try {
        entries.push({ row: this.normalizeTransactionRow(this.object(raw), rowNumber), rowNumber });
      } catch (error) {
        if (error instanceof BadRequestException) failedRows.push(rowNumber);
        else throw error;
      }
    });
    return { entries, failedRows };
  }

  private normalizeTransactionRow(row: Record<string, unknown>, rowNumber: number): ParsedTransactionRow {
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new BadRequestException(`Row ${rowNumber}: amount is invalid`);
    const currency = this.requiredText(row.currency, 'currency', rowNumber, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException(`Row ${rowNumber}: currency must be a 3-letter code`);
    const occurredAtText = this.requiredText(row.occurredAt, 'occurredAt', rowNumber, 64);
    const occurredAt = new Date(occurredAtText);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException(`Row ${rowNumber}: occurredAt is invalid`);
    return {
      accountKey: this.optionalIdentityField(row.accountKey, 'accountKey', rowNumber),
      transactionId: this.optionalIdentityField(row.transactionId, 'transactionId', rowNumber),
      relatedTransactionId: this.optionalIdentityField(row.relatedTransactionId, 'relatedTransactionId', rowNumber),
      amountMinor: Math.round(amount * 100),
      currency,
      merchant: this.optionalTextField(row.merchant, 'merchant', rowNumber, 160),
      direction: this.optionalEnumField(row.direction, 'direction', ['DEBIT', 'CREDIT'], rowNumber) as 'DEBIT' | 'CREDIT' | null,
      transactionState: this.optionalEnumField(row.transactionState, 'transactionState', ['POSTED', 'PENDING', 'REFUND', 'REVERSAL'], rowNumber) as 'POSTED' | 'PENDING' | 'REFUND' | 'REVERSAL' | null,
      occurredAt,
    };
  }

  private optionalTextField(value: unknown, field: string, row: number, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException(`Row ${row}: ${field} is invalid`);
    return value.trim() || null;
  }

  private optionalIdentityField(value: unknown, field: string, row: number): string | null {
    const result = this.optionalTextField(value, field, row, 180);
    if (result && !/^[A-Za-z0-9._:-]+$/.test(result)) throw new BadRequestException(`Row ${row}: ${field} is invalid`);
    return result;
  }

  private optionalEnumField<T extends readonly string[]>(value: unknown, field: string, values: T, row: number): T[number] | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !values.includes(value)) throw new BadRequestException(`Row ${row}: ${field} is invalid`);
    return value as T[number];
  }

  private parse(text: string, mimeType: ImportBillingFileDto['mimeType']): ParsedBillingRow[] {
    let rawRows: unknown[];
    if (mimeType === 'application/json') {
      try {
        const value = JSON.parse(text) as unknown;
        rawRows = Array.isArray(value) ? value : this.object(value).records as unknown[];
      } catch {
        throw new BadRequestException('JSON file is invalid');
      }
      if (!Array.isArray(rawRows)) throw new BadRequestException('JSON file must contain a records array');
    } else {
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return [];
      const headers = this.csvLine(lines[0]).map((header) => header.trim());
      rawRows = lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, this.csvLine(line)[index] ?? ''])));
    }
    return rawRows.map((row, index) => this.normalizeRow(this.object(row), index + 1));
  }

  private normalizeRow(row: Record<string, unknown>, rowNumber: number): ParsedBillingRow {
    const provider = this.requiredText(row.provider, 'provider', rowNumber, 120);
    const category = this.requiredText(row.category, 'category', rowNumber, 120);
    const billingPeriod = this.requiredText(row.billingPeriod, 'billingPeriod', rowNumber, 20);
    if (!/^\d{4}-\d{2}$/.test(billingPeriod)) throw new BadRequestException(`Row ${rowNumber}: billingPeriod must be YYYY-MM`);
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new BadRequestException(`Row ${rowNumber}: amount is invalid`);
    const currency = this.requiredText(row.currency, 'currency', rowNumber, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException(`Row ${rowNumber}: currency must be a 3-letter code`);
    const occurredAtText = this.requiredText(row.occurredAt, 'occurredAt', rowNumber, 64);
    const occurredAt = new Date(occurredAtText);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException(`Row ${rowNumber}: occurredAt is invalid`);
    return { provider, category, billingPeriod, amountMinor: Math.round(amount * 100), currency, occurredAt };
  }

  private csvLine(line: string) {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { values.push(value); value = ''; }
      else value += char;
    }
    if (quoted) throw new BadRequestException('CSV contains an unclosed quote');
    values.push(value);
    return values;
  }

  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Billing record must be an object');
    return value as Record<string, unknown>;
  }

  private requiredText(value: unknown, field: string, row: number, max: number) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) throw new BadRequestException(`Row ${row}: ${field} is invalid`);
    return value.trim();
  }

  private async findByIdempotency(userId: string, key: string) {
    return (await this.db.select().from(fileImports).where(and(eq(fileImports.userId, userId), eq(fileImports.idempotencyKey, key))).limit(1))[0] ?? null;
  }

  private async findById(userId: string, id: string) {
    return (await this.db.select().from(fileImports).where(and(eq(fileImports.userId, userId), eq(fileImports.id, id))).limit(1))[0] ?? null;
  }

  private toResponse(row: typeof fileImports.$inferSelect) {
    return {
      id: row.id, providerKey: row.providerKey, fileName: row.fileName, mimeType: row.mimeType,
      sizeBytes: row.sizeBytes, contentSha256: row.contentSha256, status: row.status, recordCount: row.recordCount,
      createdAt: row.createdAt.toISOString(), processedAt: row.processedAt?.toISOString() ?? null,
    };
  }
}
