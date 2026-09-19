import { BadRequestException, ForbiddenException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { appReadSessions, deviceTasks, trustedDevices, truthRecordVersions, truthRecords } from '@lazy-armor/database';
import {
  canonicalRecords, canonicalTable, redactSensitiveFields, realityValueHash, SECURITY_BLOCKED_FIELD,
  validateStructuredField,
  type AppReadProfile, type FieldExpectation, type JsonValue,
  type StructuredReadBlock, type StructuredReadEnvelope, type StructuredReadField,
  type StructuredReadRequest, type StructuredReadResult,
} from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ConnectionsService } from '../connections/connections.service';
import { DeviceTasksService } from '../device-tasks/device-tasks.service';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { resolveAppReadProfile } from './app-read-profiles';
import { LocalFileStructuredReadService, missingField, normalizeField, parseKeyValueLines } from './file-structured-reader';
import { ReadEvidenceService } from './read-evidence.service';
import { VISION_READ_ADAPTER, type VisionReadAdapter } from './vision-adapter';

export const AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE = 'AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE';
export const AWAITING_VISION_PROVIDER_CREDENTIALS = 'AWAITING_VISION_PROVIDER_CREDENTIALS';
export const AWAITING_VISION_LIVE_EVIDENCE = 'AWAITING_VISION_LIVE_EVIDENCE';

const PROVIDER_CAPABILITY: Record<string, string> = {
  FeishuDoc: 'FEISHU_DOC_READ',
  FeishuSheet: 'FEISHU_SHEET_READ',
  FeishuBitable: 'FEISHU_BITABLE_READ',
};

/**
 * R6 Controlled Structured Read. This is a Source Acquisition / Parsing adapter
 * on top of the existing Reality Pipeline — it never builds a second Truth
 * Engine. Source and Action stay separated: this service only produces
 * Observation -> Candidate -> Truth and never performs provider actions.
 */
@Injectable()
export class StructuredReadService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly pipeline: RealityPipelineService,
    private readonly evidence: ReadEvidenceService,
    private readonly files: LocalFileStructuredReadService,
    private readonly connections: ConnectionsService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => DeviceTasksService)) private readonly deviceTasks: DeviceTasksService,
    @Inject(VISION_READ_ADAPTER) private readonly vision: VisionReadAdapter,
  ) {}

  async structuredRead(userId: string, request: StructuredReadRequest): Promise<StructuredReadResult> {
    switch (request.sourceType) {
      case 'PROVIDER': return this.providerRead(userId, request);
      case 'FILE': case 'PDF_PAGE': return this.fileRead(userId, request);
      case 'IMAGE': return this.imageRead(userId, request);
      case 'DEVICE_APP': return this.androidRead(userId, request);
      default: throw new BadRequestException('Unsupported structured read source');
    }
  }

  async readFile(userId: string, request: StructuredReadRequest, content: Buffer, fileName: string, mimeType: string): Promise<StructuredReadResult> {
    const fileHash = createHash('sha256').update(content).digest('hex');
    const output = await this.files.read({
      requestId: request.requestId, resourceType: request.resourceType, resourceId: request.resourceId,
      fileName, mimeType, content, requestedFields: request.requestedFields, fieldExpectations: request.fieldExpectations,
      fileHash, pageNumber: request.pageRange?.from, pageCount: request.pageRange?.to ? request.pageRange.to - request.pageRange.from + 1 : undefined,
    });
    if (output.needsVisionFallback || !output.envelope) {
      return this.imageRead(userId, { ...request, resourceId: request.resourceId }, content);
    }
    return this.finalize(userId, request, output.envelope, {});
  }

  /** Android controlled structured read: session guard + DeviceTask enqueue. */
  async androidRead(userId: string, request: StructuredReadRequest): Promise<StructuredReadResult> {
    const profile = this.requireProfile(request.packageName);
    const session = await this.assertReadSession(userId, request);
    const task = await this.deviceTasks.enqueue(userId, session.trustedDeviceId, 'APP_STRUCTURED_READ', 'structured_read.field', profile.resourceType, {
      requestId: request.requestId, packageName: profile.packageName, resourceType: profile.resourceType, resourceId: request.resourceId,
      requestedFields: request.requestedFields, fieldExpectations: request.fieldExpectations ?? {}, appReadSessionId: session.id,
      structuredSelector: request.structuredSelector ?? null, resourceHint: request.resourceHint ?? null,
    });
    return {
      requestId: request.requestId,
      status: AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE,
      readMethod: 'ANDROID_STRUCTURED',
      fields: [],
      candidateIds: [],
      truthRecordIds: [],
      acceptance: { android: AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE, deviceTaskId: task.id },
      warnings: ['Enqueued APP_STRUCTURED_READ; awaiting signed device UI-node evidence'],
    };
  }

  /** Called by DeviceTasksService.complete for APP_STRUCTURED_READ / SCREEN_CAPTURE_FOR_READ results. */
  async ingestDeviceResult(userId: string, task: typeof deviceTasks.$inferSelect, result: Record<string, unknown>): Promise<{ observationId: string; candidateIds: string[]; truthRecordIds: string[] }> {
    const payload = task.payloadJson as Record<string, unknown>;
    const profile = this.requireProfile(typeof payload.packageName === 'string' ? payload.packageName : null);
    const observedPackage = typeof result.packageName === 'string' ? result.packageName : null;
    if (observedPackage !== profile.packageName) throw new ForbiddenException('Device result package does not match the read profile');
    const resourceId = typeof result.resourceId === 'string' ? result.resourceId : null;
    if (resourceId !== null && resourceId !== payload.resourceId) throw new ForbiddenException('Device result resource does not match the requested resource');
    if (task.userId !== userId) throw new ForbiddenException('Device result belongs to a different user');
    const nodes = Array.isArray(result.nodes) ? result.nodes as Array<Record<string, unknown>> : [];
    if (!nodes.length) throw new BadRequestException('Structured device read requires UI nodes');
    const request: StructuredReadRequest = {
      requestId: typeof payload.requestId === 'string' ? payload.requestId : task.id,
      userId, sourceType: 'DEVICE_APP', resourceType: profile.resourceType, resourceId: typeof payload.resourceId === 'string' ? payload.resourceId : task.id,
      packageName: profile.packageName, appReadSessionId: typeof payload.appReadSessionId === 'string' ? payload.appReadSessionId : null,
      structuredSelector: typeof payload.structuredSelector === 'string' ? payload.structuredSelector : null,
      resourceHint: typeof payload.resourceHint === 'string' ? payload.resourceHint : null,
      requestedFields: Array.isArray(payload.requestedFields) ? payload.requestedFields as string[] : [],
      fieldExpectations: (payload.fieldExpectations as Record<string, FieldExpectation> | undefined) ?? {},
    };
    const envelope = this.envelopeFromUiNodes(request, profile, nodes, result);
    const finalized = await this.finalize(userId, request, envelope, { android: AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE });
    return { observationId: finalized.observationId ?? '', candidateIds: finalized.candidateIds, truthRecordIds: finalized.truthRecordIds };
  }

  private async providerRead(userId: string, request: StructuredReadRequest): Promise<StructuredReadResult> {
    if (request.providerKey !== 'feishu') throw new BadRequestException('Provider structured read is only implemented for feishu');
    const capability = PROVIDER_CAPABILITY[request.resourceType];
    if (!capability || !request.connectionId) throw new BadRequestException('Unsupported provider structured read resource');
    const read = await this.connections.invokeConsumerRead(userId, request.connectionId, {
      capability, requestId: `structured-read:${request.requestId}`, input: this.providerReadInput(request),
    });
    const resources = Array.isArray(read.data?.resources) ? read.data.resources as Array<Record<string, unknown>> : [];
    if (!resources.length) throw new BadRequestException('Provider structured read returned no resources');
    const envelope = this.envelopeFromProviderResource(request, capability, resources[0]);
    return this.finalize(userId, request, envelope, {});
  }

  private providerReadInput(request: StructuredReadRequest): Record<string, unknown> {
    if (request.resourceType === 'FeishuDoc') return { documentId: request.resourceId };
    if (request.resourceType === 'FeishuSheet') return { spreadsheetToken: request.resourceId, range: request.structuredSelector ?? '' };
    if (request.resourceType === 'FeishuBitable') return { appToken: request.resourceId, tableId: request.structuredSelector ?? '' };
    throw new BadRequestException('Unsupported provider structured read resource');
  }

  private async fileRead(userId: string, request: StructuredReadRequest): Promise<StructuredReadResult> {
    // Files are read through readFile(userId, request, content, ...) which the
    // controller resolves from the request body; a bare FILE request without
    // content cannot produce an envelope.
    throw new BadRequestException('File structured read requires file content');
  }

  private async imageRead(userId: string, request: StructuredReadRequest, content?: Buffer): Promise<StructuredReadResult> {
    const imageHash = content ? createHash('sha256').update(content).digest('hex') : createHash('sha256').update(request.resourceId).digest('hex');
    const visionInput = {
      requestId: request.requestId, resourceType: request.resourceType, resourceId: request.resourceId,
      requestedFields: request.requestedFields, fieldExpectations: request.fieldExpectations, imageHash,
      mediaKind: 'image' as const, pageNumber: request.pageRange?.from,
    };
    const extraction = await this.vision.extract(visionInput);
    const fields = extraction.fields.map((field) => validateStructuredField(field));
    const envelope: StructuredReadEnvelope = {
      requestId: request.requestId, sourceType: 'IMAGE', resourceType: request.resourceType, resourceId: request.resourceId,
      readMethod: 'VISION_FALLBACK', parserId: 'generic.structured-read.v1', parserVersion: 1, observedAt: new Date().toISOString(),
      contentHash: imageHash, evidenceHash: createHash('sha256').update(imageHash + ':vision').digest('hex'),
      sourceIdentity: `vision:${imageHash}`, resourceIdentity: `${request.resourceType}:${request.resourceId}`,
      confidence: fields.length ? fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length : 0,
      blocks: [], fields, warnings: extraction.warnings,
      provenance: { extractionMethod: 'vision', fileHash: imageHash, pageNumber: request.pageRange?.from },
    };
    return this.finalize(userId, request, envelope, { vision: AWAITING_VISION_LIVE_EVIDENCE, visionProvider: AWAITING_VISION_PROVIDER_CREDENTIALS });
  }

  /** Shared tail: validate/redact, persist evidence, ingest -> Candidate -> Truth. */
  private async finalize(userId: string, request: StructuredReadRequest, envelope: StructuredReadEnvelope, acceptance: Record<string, string>): Promise<StructuredReadResult> {
    const fields = redactSensitiveFields(envelope.fields.map((field) => validateStructuredField(field)));
    const evidenceRecord = await this.evidence.create(userId, {
      requestId: envelope.requestId, sourceType: envelope.sourceType, resourceType: envelope.resourceType, resourceId: envelope.resourceId,
      readMethod: envelope.readMethod, parserId: envelope.parserId, contentHash: envelope.contentHash, evidenceHash: envelope.evidenceHash,
      sourceIdentity: envelope.sourceIdentity, resourceIdentity: envelope.resourceIdentity, observedAt: envelope.observedAt,
      confidence: envelope.confidence, warnings: envelope.warnings, status: 'CAPTURED',
    }, envelope.readMethod);
    const blockedFields = fields.filter((field) => field.redacted || field.validation.errors.includes(SECURITY_BLOCKED_FIELD));
    if (blockedFields.length) {
      await this.evidence.advance(userId, evidenceRecord.id, 'BLOCKED', { blockedReason: SECURITY_BLOCKED_FIELD });
      return {
        requestId: request.requestId, status: 'BLOCKED', readMethod: envelope.readMethod, fields,
        candidateIds: [], truthRecordIds: [], evidenceId: evidenceRecord.id, acceptance, warnings: envelope.warnings,
      };
    }
    const ingestible = fields.filter((field) => field.validation.status !== 'EXTRACTION_INVALID');
    if (!ingestible.length) {
      await this.evidence.advance(userId, evidenceRecord.id, 'BLOCKED', { blockedReason: 'EXTRACTION_INVALID' });
      return {
        requestId: request.requestId, status: 'BLOCKED', readMethod: envelope.readMethod, fields,
        candidateIds: [], truthRecordIds: [], evidenceId: evidenceRecord.id, acceptance, warnings: envelope.warnings,
      };
    }
    await this.evidence.advance(userId, evidenceRecord.id, envelope.readMethod === 'VISION_FALLBACK' ? 'VISION_FALLBACK' : 'STRUCTURED_READ');
    await this.evidence.advance(userId, evidenceRecord.id, 'NORMALIZED');

    const payload: Record<string, JsonValue> = {
      resourceType: request.resourceType, resourceId: request.resourceId,
      sourceIdentity: envelope.sourceIdentity, readMethod: envelope.readMethod, observedAt: envelope.observedAt,
      ...(envelope.resourceVersion ? { resourceVersion: envelope.resourceVersion } : {}),
      fields: ingestible.map(fieldToJson),
    };
    const providerKey = request.providerKey ?? (envelope.readMethod === 'ANDROID_STRUCTURED' ? 'edge-device' : envelope.readMethod === 'VISION_FALLBACK' ? 'vision' : 'local-file');
    const observed = await this.pipeline.ingest(userId, {
      sourceMode: envelope.sourceType === 'DEVICE_APP' ? 'INTERNAL' : envelope.sourceType === 'PROVIDER' ? 'OFFICIAL_API' : 'FILE',
      providerKey, connectionId: request.connectionId ?? null,
      externalEventKey: `structured-read:${request.requestId}`,
      parserKey: 'generic.structured-read.v1', resourceHint: request.resourceType,
      payload, evidenceHash: envelope.evidenceHash, observedAt: envelope.observedAt,
    });
    const candidateIds = observed.candidates.map((candidate) => candidate.id);
    await this.evidence.advance(userId, evidenceRecord.id, 'CANDIDATE_CREATED', { observationId: observed.observationId, candidateIds });

    const truthRecordIds: string[] = [];
    const validCandidates = observed.candidates.filter((candidate) => candidate.value && typeof candidate.value === 'object' && (candidate.value as Record<string, unknown>).confidence !== undefined && Number((candidate.value as Record<string, unknown>).confidence) >= 0.8);
    for (const candidate of validCandidates) {
      if (await this.isStaleVersion(userId, candidate.subjectKey, envelope.resourceVersion)) {
        await this.pipeline.rejectCandidate(userId, candidate.id).catch(() => undefined);
        continue;
      }
      const truth = await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'structured_read_validation', verificationMethod: 'DETERMINISTIC_VALIDATION' });
      truthRecordIds.push(truth.id);
    }
    const needsConfirmation = observed.candidates.some((candidate) => candidate.value && typeof candidate.value === 'object' && Number((candidate.value as Record<string, unknown>).confidence) < 0.8);
    const finalStatus = needsConfirmation && !truthRecordIds.length ? 'NEEDS_CONFIRMATION' : truthRecordIds.length ? 'VERIFIED' : 'NEEDS_CONFIRMATION';
    await this.evidence.advance(userId, evidenceRecord.id, finalStatus === 'VERIFIED' ? 'TRUTH_VERIFIED' : 'NEEDS_CONFIRMATION', { truthRecordIds });
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'STRUCTURED_READ_COMPLETED', resourceType: 'read_evidence', resourceId: evidenceRecord.id,
      userId, correlationId: request.requestId, changeSummary: `Structured read ${request.resourceType}/${request.resourceId} via ${envelope.readMethod} -> ${finalStatus}`,
      source: 'api', result: finalStatus === 'VERIFIED' ? 'success' : 'blocked',
    });
    return {
      requestId: request.requestId, status: finalStatus, readMethod: envelope.readMethod, fields,
      observationId: observed.observationId, candidateIds, truthRecordIds, evidenceId: evidenceRecord.id, acceptance, warnings: envelope.warnings,
    };
  }

  private async isStaleVersion(userId: string, subjectKey: string, resourceVersion?: string | null): Promise<boolean> {
    if (!resourceVersion) return false;
    const incoming = Date.parse(resourceVersion);
    if (!Number.isFinite(incoming)) return false;
    const existing = (await this.db.select({ currentVersionId: truthRecords.currentVersionId }).from(truthRecords)
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.subjectKey, subjectKey), eq(truthRecords.status, 'verified'))).limit(1))[0];
    if (!existing?.currentVersionId) return false;
    const version = (await this.db.select({ valueJson: truthRecordVersions.valueJson }).from(truthRecordVersions).where(eq(truthRecordVersions.id, existing.currentVersionId)).limit(1))[0];
    const value = version?.valueJson as Record<string, unknown> | undefined;
    const current = value?.value && typeof value.value === 'object' ? (value.value as Record<string, unknown>).resourceVersion : undefined;
    if (typeof current !== 'string') return false;
    const currentTime = Date.parse(current);
    return Number.isFinite(currentTime) && currentTime >= incoming;
  }

  private requireProfile(packageName: string | null | undefined): AppReadProfile {
    const profile = packageName ? resolveAppReadProfile(packageName) : null;
    if (!profile) throw new ForbiddenException('No App Read Profile is registered for this package');
    return profile;
  }

  private async assertReadSession(userId: string, request: StructuredReadRequest) {
    if (!request.appReadSessionId || !request.packageName) throw new BadRequestException('Android structured read requires appReadSessionId and packageName');
    const session = (await this.db.select().from(appReadSessions).where(and(eq(appReadSessions.id, request.appReadSessionId), eq(appReadSessions.userId, userId))).limit(1))[0];
    if (!session) throw new ForbiddenException('App read session not found for this user');
    if (session.expiresAt.getTime() <= Date.now() || session.activeDeviceKey === null || !['CREATED', 'WAITING_FOREGROUND', 'READING'].includes(session.status)) {
      throw new ForbiddenException('App read session is expired or no longer active');
    }
    if (session.targetPackage !== request.packageName) throw new ForbiddenException('App read session package does not match the request');
    if (request.deviceId) {
      const device = (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id, session.trustedDeviceId), eq(trustedDevices.userId, userId))).limit(1))[0];
      if (!device || device.deviceId !== request.deviceId) throw new ForbiddenException('App read session device does not match the request');
    }
    return session;
  }

  private envelopeFromProviderResource(request: StructuredReadRequest, capability: string, resource: Record<string, unknown>): StructuredReadEnvelope {
    const observedAt = new Date().toISOString();
    const contentHash = realityValueHash(resource);
    const blocks: StructuredReadBlock[] = [];
    let fields: Array<Omit<StructuredReadField, 'validation'>> = [];
    let resourceVersion: string | null = null;
    if (capability === 'FEISHU_DOC_READ') {
      const docBlocks = Array.isArray(resource.blocks) ? resource.blocks as Array<Record<string, unknown>> : [];
      const entries: Array<{ key: string; value: JsonValue }> = [];
      for (const block of docBlocks) {
        const text = typeof block.text === 'string' ? block.text : '';
        const heading = /^(#{1,6})\s+(.+)$/.exec(text.trim());
        if (heading) { blocks.push({ type: 'HEADING', level: heading[1].length, text: heading[2] }); continue; }
        if (text) blocks.push({ type: 'TEXT', text });
        entries.push(...parseKeyValueLines(text));
      }
      fields = this.extractFromEntries(entries, request);
      resourceVersion = typeof resource.revision === 'string' && resource.revision ? new Date(/^\d{9,13}$/.test(resource.revision) ? Number(resource.revision) * 1000 : resource.revision).toISOString() : null;
    } else if (capability === 'FEISHU_SHEET_READ') {
      const values = Array.isArray(resource.values) ? resource.values as JsonValue[][] : [];
      const table = canonicalTable(values);
      blocks.push(table);
      const entries = sheetEntries(values);
      fields = this.extractFromEntries(entries, request);
      resourceVersion = typeof resource.updatedAt === 'string' ? new Date(resource.updatedAt).toISOString() : null;
    } else if (capability === 'FEISHU_BITABLE_READ') {
      const records = Array.isArray(resource.records) ? resource.records as Array<Record<string, unknown>> : [];
      const flat = records.map((record) => (record.fields && typeof record.fields === 'object' ? record.fields : record) as Record<string, JsonValue>);
      blocks.push(canonicalRecords(flat));
      const entries: Array<{ key: string; value: JsonValue }> = [];
      for (const record of flat) for (const [key, value] of Object.entries(record)) entries.push({ key, value });
      fields = this.extractFromEntries(entries, request);
      resourceVersion = typeof resource.updatedAt === 'string' ? new Date(resource.updatedAt).toISOString() : null;
    }
    const validatedFields = fields.map((field) => validateStructuredField(field));
    return {
      requestId: request.requestId, sourceType: 'PROVIDER', resourceType: request.resourceType, resourceId: request.resourceId,
      readMethod: 'PROVIDER_STRUCTURED', parserId: 'generic.structured-read.v1', parserVersion: 1, observedAt,
      contentHash, evidenceHash: createHash('sha256').update(contentHash + ':provider').digest('hex'),
      sourceIdentity: `feishu:${request.connectionId ?? ''}`, resourceIdentity: `${request.resourceType}:${request.resourceId}`,
      resourceVersion, confidence: validatedFields.length ? validatedFields.reduce((sum, field) => sum + field.confidence, 0) / validatedFields.length : 1,
      blocks, fields: validatedFields, warnings: [],
      provenance: { documentId: typeof resource.documentId === 'string' ? resource.documentId : undefined,
        sheetId: typeof resource.spreadsheetToken === 'string' ? resource.spreadsheetToken : undefined,
        recordId: typeof resource.recordId === 'string' ? resource.recordId : undefined,
        revision: typeof resource.revision === 'string' ? resource.revision : undefined },
    };
  }

  private envelopeFromUiNodes(request: StructuredReadRequest, profile: AppReadProfile, nodes: Array<Record<string, unknown>>, result: Record<string, unknown>): StructuredReadEnvelope {
    const observedAt = typeof result.observedAt === 'string' ? result.observedAt : new Date().toISOString();
    const contentHash = realityValueHash({ nodes, packageName: profile.packageName });
    const blocks: StructuredReadBlock[] = [{
      type: 'UI_NODE', screenId: typeof result.screenId === 'string' ? result.screenId : undefined,
      packageName: profile.packageName, activityName: typeof result.activityName === 'string' ? result.activityName : undefined,
      nodes: nodes.map((node) => ({
        text: typeof node.text === 'string' ? node.text : undefined,
        contentDescription: typeof node.contentDescription === 'string' ? node.contentDescription : undefined,
        role: typeof node.role === 'string' ? node.role : undefined,
        bounds: typeof node.bounds === 'object' ? node.bounds as { left: number; top: number; right: number; bottom: number } : undefined,
        enabled: typeof node.enabled === 'boolean' ? node.enabled : undefined,
        selected: typeof node.selected === 'boolean' ? node.selected : undefined,
        resourceId: typeof node.resourceId === 'string' ? node.resourceId : undefined,
      })),
    }];
    const fields = request.requestedFields.map((fieldName) => {
      const node = nodes.find((item) => item.resourceId === fieldName || item.contentDescription === fieldName) ?? nodes.find((item) => String(item.resourceId ?? '').endsWith(`/${fieldName}`));
      if (!node) return missingField(fieldName, request.fieldExpectations?.[fieldName]);
      const text = typeof node.text === 'string' ? node.text : '';
      return normalizeField(fieldName, text, request.fieldExpectations?.[fieldName]);
    }).map((field) => validateStructuredField(field));
    return {
      requestId: request.requestId, sourceType: 'DEVICE_APP', resourceType: profile.resourceType, resourceId: request.resourceId,
      readMethod: 'ANDROID_STRUCTURED', parserId: 'generic.structured-read.v1', parserVersion: 1, observedAt,
      contentHash, evidenceHash: createHash('sha256').update(contentHash + ':android').digest('hex'),
      sourceIdentity: `android:${profile.packageName}`, resourceIdentity: `${profile.resourceType}:${request.resourceId}`,
      confidence: fields.length ? fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length : 0,
      blocks, fields, warnings: [],
      provenance: { extractionMethod: 'android-ui-nodes', pageNumber: undefined },
    };
  }

  private extractFromEntries(entries: Array<{ key: string; value: JsonValue }>, request: StructuredReadRequest): Array<Omit<StructuredReadField, 'validation'>> {
    const byKey = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
    return request.requestedFields.map((fieldName) => {
      const raw = byKey.get(fieldName.toLowerCase()) ?? byKey.get(fieldName);
      if (!raw) return missingField(fieldName, request.fieldExpectations?.[fieldName]);
      return normalizeField(fieldName, raw.value, request.fieldExpectations?.[fieldName]);
    });
  }
}

function fieldToJson(field: StructuredReadField): Record<string, JsonValue> {
  return {
    field: field.field, rawText: field.rawText, normalizedValue: field.normalizedValue, type: field.type, confidence: field.confidence,
    ...(field.sourceRegion ? { sourceRegion: { page: field.sourceRegion.page ?? null, screen: field.sourceRegion.screen ?? null } } : {}),
    validation: { status: field.validation.status, errors: field.validation.errors },
  };
}

function sheetEntries(values: JsonValue[][]): Array<{ key: string; value: JsonValue }> {
  if (!values.length) return [];
  const header = values[0].map((cell) => String(cell ?? ''));
  const entries: Array<{ key: string; value: JsonValue }> = [];
  header.forEach((column, index) => {
    const columnValues = values.slice(1).map((row) => row[index]).filter((value) => value !== undefined && value !== null && value !== '');
    if (!column) return;
    entries.push({ key: column, value: columnValues.length === 1 ? columnValues[0] : columnValues });
  });
  return entries;
}
