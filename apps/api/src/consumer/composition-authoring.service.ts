import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { consumerConversations, consumerMessages } from '@lazy-armor/database';
import { catalogHash, compileSkillResourceGraph, compositionAuthoringSelectionSchema, compositionAuthoringSnapshotSchema, goalBriefSchema,
  agentReportSchema, reportTerminal, reportCompositionSchema, requestsReport, skillMethodPorts, type ReportComposition, type CompositionAuthoringSnapshot } from '@lazy-armor/plan-schema';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SkillRepositoriesService } from '../portable-skills/skill-repositories.service';
import { CompositionPreviewService } from './composition-preview.service';
import { ConsumerService } from './consumer.service';
import { GoalResourceMatchService } from './goal-resource-match.service';
import { CompositionReportResourcesService } from './composition-report-resources.service';

type Transaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/** Bridges reviewed graph input to existing durable authoring. It cannot compile or execute a recipe. */
@Injectable()
export class CompositionAuthoringService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly preview: CompositionPreviewService,
    private readonly methods: SkillRepositoriesService, private readonly resources: GoalResourceMatchService, private readonly modules: ModuleRef,
    private readonly reportResources: CompositionReportResourcesService) {}

  async submit(userId: string, conversationId: string, requestId: string, raw: unknown) {
    const parsed = compositionAuthoringSelectionSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('COMPOSITION_INPUT_INVALID');
    const selection = parsed.data, selectionHash = catalogHash(selection);
    const consumer = this.modules.get(ConsumerService, { strict: false });
    const conversation = await consumer.conversation(userId, conversationId);
    const prior = conversation.messages.find(row => row.requestId === requestId && row.role === 'user');
    if (prior) {
      const saved = compositionAuthoringSnapshotSchema.safeParse(prior.structuredPayload?.composition);
      if (!saved.success || saved.data.selectionHash !== selectionHash) throw new ConflictException('COMPOSITION_REPLAY_MISMATCH');
      // Return the original job even after the context changes. Never create a second computation on retry.
      return consumer.conversation(userId, conversationId);
    }
    if (conversation.planId || !['ACTIVE'].includes(conversation.status)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    const source = conversation.messages.filter(row => row.role === 'assistant').at(-1);
    const goal = goalBriefSchema.safeParse(source?.structuredPayload?.goalBrief);
    if (!source || !goal.success) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    const sourceReport = agentReportSchema.safeParse(source.structuredPayload?.report);
    if (sourceReport.success && !reportTerminal(sourceReport.data.stage)) throw new ConflictException('COMPOSITION_SOURCE_REPORT_IN_PROGRESS');
    const graph = await this.preview.preview(userId, conversationId, selection.graph);
    if (graph.state !== 'STRUCTURE_VALID') throw new BadRequestException('COMPOSITION_STRUCTURE_BLOCKED');
    const basis = { goalBriefRef: graph.goalBriefRef, methodRefs: graph.methodRefs, sourceMessageRefs: graph.sourceMessageRefs };
    if (catalogHash(basis) !== catalogHash(selection.basis)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    let snapshot = compositionAuthoringSnapshotSchema.parse({ schemaVersion: 'composition-authoring.v1', kind: 'PLANNING_REFERENCE',
      executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED', selection, selectionHash,
      sourceAssistant: { id: source.id, payloadHash: catalogHash(source.structuredPayload) }, sourceGoal: goal.data,
      orderedMethodIds: graph.orderedMethodIds, riskFloor: graph.riskFloor, resourcesObservedAt: graph.resourcesObservedAt });
    if (requestsReport(goal.data.statement)) {
      snapshot = compositionAuthoringSnapshotSchema.parse({ ...snapshot, reportReadBindings: await this.reportResources.bind(userId, graph, selection.resourceSelections ?? []) });
      await this.buildReportGuidance(userId, snapshot);
    } else if (selection.resourceSelections?.length) throw new BadRequestException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
    return consumer.message(userId, conversationId, { content: goal.data.statement, requestId, version: selection.graph.version, authoringMode: 'DURABLE' }, snapshot);
  }

  async recheck(userId: string, conversationId: string, snapshot: CompositionAuthoringSnapshot, version: number, phase: 'AUTHORING' | 'REPORT' = 'AUTHORING') {
    await this.db.transaction(tx => this.assertCurrent(tx, userId, conversationId, snapshot, phase));
    const choices = await this.methods.selectedContext(userId, snapshot.selection.basis.methodRefs);
    const resources = phase === 'REPORT' ? await this.resources.forMethods(userId, conversationId, version) : await this.resources.forAuthoring(userId, conversationId, version);
    const graph = compileSkillResourceGraph({ ...snapshot.selection.graph, version }, choices, snapshot.sourceGoal, resources);
    if (graph.state !== 'STRUCTURE_VALID' || graph.riskFloor !== snapshot.riskFloor || catalogHash(graph.orderedMethodIds) !== catalogHash(snapshot.orderedMethodIds)) throw new ConflictException('COMPOSITION_RESOURCES_CHANGED');
    return graph;
  }

  async reportGuidance(userId: string, conversationId: string, snapshot: CompositionAuthoringSnapshot, version: number): Promise<ReportComposition> {
    await this.recheck(userId, conversationId, snapshot, version);
    return this.buildReportGuidance(userId, snapshot);
  }
  private async buildReportGuidance(userId: string, snapshot: CompositionAuthoringSnapshot): Promise<ReportComposition> {
    const selected = await this.methods.selectedContext(userId, snapshot.selection.basis.methodRefs);
    const methods = snapshot.orderedMethodIds.map(id => selected.find(method => method.ref.entryId === id)!);
    // This adapter consumes only report text and public read capabilities supported by the existing report worker.
    if (snapshot.sourceGoal.outcomeKind !== 'REPORT' || methods.some(method => method.manifest.permission.some(value => value !== 'READ') ||
      method.manifest.requiredCapabilities.some(key => !['READ_PUBLIC_HTTP_JSON', 'READ_PUBLIC_WEB_RESEARCH'].includes(key))) ||
      snapshot.selection.graph.deliveries.some(delivery => skillMethodPorts(methods.find(method => method.ref.entryId === delivery.methodId)!.manifest.output)?.fields[delivery.outputField] !== 'string'))
      throw new ConflictException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
    if (snapshot.selection.graph.deliveries.some(delivery => delivery.label.length > 100) ||
      new Set(snapshot.selection.graph.deliveries.map(delivery => delivery.label)).size !== snapshot.selection.graph.deliveries.length)
      throw new ConflictException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
    if (snapshot.sourceGoal.fields.some(field => field.sourceRefs.some(ref => ref.kind !== 'USER_MESSAGE')))
      throw new ConflictException('COMPOSITION_REPORT_CONFIRMED_SOURCE_UNSUPPORTED');
    const needs = methods.flatMap(method => [...new Set(method.manifest.requiredCapabilities)].map(capabilityKey => ({ methodId: method.ref.entryId, capabilityKey })));
    if (needs.length !== (snapshot.reportReadBindings?.length ?? 0) || needs.some(need => !snapshot.reportReadBindings?.some(binding => binding.methodId === need.methodId && binding.capabilityKey === need.capabilityKey)))
      throw new ConflictException('COMPOSITION_REPORT_BINDINGS_REQUIRED');
    return reportCompositionSchema.parse({ adapter: 'REPORT_METHOD_CHAIN_V1', snapshot, methods });
  }

  /** Runs inside the original admission/publication transaction, under its conversation lock. */
  async assertCurrent(tx: Transaction, userId: string, conversationId: string, raw: unknown, phase: 'AUTHORING' | 'CONFIRMATION' | 'REPORT' = 'AUTHORING') {
    const parsed = compositionAuthoringSnapshotSchema.safeParse(raw);
    if (!parsed.success) throw new ConflictException('COMPOSITION_SNAPSHOT_INVALID');
    const snapshot = parsed.data;
    if (snapshot.sourceGoal.goalId !== conversationId || snapshot.selectionHash !== catalogHash(snapshot.selection) ||
      snapshot.selection.basis.goalBriefRef.contentHash !== catalogHash(snapshot.sourceGoal)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId))).for('update'))[0];
    const refs = (conversation?.contextRefs ?? []).flatMap(ref => ref.type === 'SkillMethod' ? [ref.methodRef] : []);
    const version = snapshot.selection.graph.version;
    if (!conversation || conversation.deletedAt || conversation.archivedAt || conversation.planId ||
      !(phase === 'REPORT' ? conversation.version === version + 1 && ['ACTIVE', 'PROCESSING'].includes(conversation.status) :
        phase === 'CONFIRMATION' ? conversation.version === version + 1 && conversation.status === 'ACTIVE' :
        conversation.version === version && conversation.status === 'ACTIVE' || conversation.version === version + 1 && conversation.status === 'PROCESSING') ||
      catalogHash(refs) !== catalogHash(snapshot.selection.basis.methodRefs)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    if (!await this.methods.refsCurrent(tx, userId, refs)) throw new ConflictException('SKILL_CONTEXT_CHANGED');
    const source = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, snapshot.sourceAssistant.id),
      eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant'))).for('update'))[0];
    if (!source || catalogHash(source.structuredPayload) !== snapshot.sourceAssistant.payloadHash ||
      catalogHash(source.structuredPayload?.goalBrief) !== snapshot.selection.basis.goalBriefRef.contentHash) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    // In admission the latest answer must still be exactly the reviewed one.
    if (conversation.version === version) {
      const latest = (await tx.select({ id: consumerMessages.id }).from(consumerMessages).where(and(eq(consumerMessages.conversationId, conversationId),
        eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt), desc(consumerMessages.id)).limit(1))[0];
      if (latest?.id !== source.id) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    }
    for (const ref of snapshot.selection.basis.sourceMessageRefs) {
      const row = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, ref.id), eq(consumerMessages.conversationId, conversationId),
        eq(consumerMessages.role, 'user'))).for('update'))[0];
      if (!row || catalogHash(row.content) !== ref.contentHash) throw new ConflictException('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
    }
    if (snapshot.reportReadBindings) await this.reportResources.assertCurrent(userId, snapshot.reportReadBindings, tx);
    return snapshot;
  }
}
