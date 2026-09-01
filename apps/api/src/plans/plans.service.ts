import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  connections,
  connectorCapabilities,
  connectors,
  executionSteps,
  executions,
  planActions,
  planConditions,
  planSources,
  planTriggers,
  planVersions,
  plans,
} from '@lazy-armor/database';
import {
  ACTION_DEFINITIONS,
  definitionHash,
  normalizePlanDefinition,
  type PlanDefinition,
  type PlanDefinitionInput,
  type PlanState,
} from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { PlanDefinitionAssembler, type PlanQueryExecutor } from './plan-definition.assembler';
import { PlanStateService } from './plan-state.service';
import { resolvePlanTemplate } from '../templates/template-registry';

type PlanExecutor = PlanQueryExecutor & Pick<InjectedDatabase, 'insert' | 'update'>;
type TemplateVersionMetadata = {
  templateKey?: string | null;
  templateVersion?: string | null;
  templateConfig?: Record<string, unknown> | null;
};

const CONNECTION_REQUIRED_SOURCES = new Set([
  'email', 'calendar', 'webhook', 'commerce', 'device', 'vehicle', 'content_platform',
]);

@Injectable()
export class PlansService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly assembler: PlanDefinitionAssembler,
    private readonly stateMachine: PlanStateService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: PlanDefinitionInput) {
    const parsed = this.parse(input);
    const planId = newId();
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(plans).values({
        id: planId,
        userId,
        status: 'draft',
        currentVersionId: null,
        activeVersionId: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      const resolved = await this.resolveReferences(tx, userId, parsed);
      const versionId = await this.insertVersion(tx, userId, planId, 1, resolved, now);
      await tx.update(plans).set({ currentVersionId: versionId, updatedAt: now }).where(eq(plans.id, planId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'PLAN_CREATED', resourceType: 'plan', resourceId: planId, userId, correlationId: planId, changeSummary: `Plan created with version 1: ${parsed.name}`, source: 'api', result: 'success' }, tx);
    });
    return this.get(userId, planId);
  }

  async createFromTemplate(userId: string, input: PlanDefinitionInput, metadata: TemplateVersionMetadata) {
    const parsed = this.parse(input);
    const planId = newId();
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(plans).values({
        id: planId,
        userId,
        status: 'draft',
        currentVersionId: null,
        activeVersionId: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      const resolved = await this.resolveReferences(tx, userId, parsed);
      const versionId = await this.insertVersion(tx, userId, planId, 1, resolved, now, metadata);
      await tx.update(plans).set({ currentVersionId: versionId, updatedAt: now }).where(eq(plans.id, planId));
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'PLAN_CREATED_FROM_TEMPLATE',
        resourceType: 'plan',
        resourceId: planId,
        userId,
        correlationId: planId,
        changeSummary: `Plan created from template ${metadata.templateKey}@${metadata.templateVersion}: ${parsed.name}`,
        source: 'api',
        result: 'success',
      }, tx);
    });
    return this.get(userId, planId);
  }

  async list(userId: string) {
    const rows = await this.db.select().from(plans)
      .where(eq(plans.userId, userId))
      .orderBy(desc(plans.updatedAt));
    return Promise.all(rows.map((row) => this.toResponse(userId, row)));
  }

  async get(userId: string, planId: string) {
    const row = await this.getOwnedPlan(userId, planId);
    return this.toResponse(userId, row);
  }

  async listVersions(userId: string, planId: string) {
    await this.getOwnedPlan(userId, planId);
    return this.db.select({
      id: planVersions.id,
      versionNumber: planVersions.versionNumber,
      name: planVersions.name,
      description: planVersions.description,
      domain: planVersions.domain,
      automationLevel: planVersions.automationLevel,
      templateKey: planVersions.templateKey,
      templateVersion: planVersions.templateVersion,
      templateConfig: planVersions.templateConfigJson,
      definitionHash: planVersions.definitionHash,
      createdBy: planVersions.createdBy,
      createdAt: planVersions.createdAt,
    }).from(planVersions)
      .where(eq(planVersions.planId, planId))
      .orderBy(desc(planVersions.versionNumber));
  }

  async getVersion(userId: string, planId: string, versionNumber: number) {
    const assembled = await this.assembler.assemble(userId, planId, versionNumber);
    return { ...assembled.version, templateConfig: assembled.version.templateConfigJson, definition: assembled.definition, computedHash: assembled.computedHash };
  }

  async createVersion(userId: string, planId: string, input: PlanDefinitionInput) {
    const parsed = this.parse(input);
    let createdVersion = 0;
    await this.db.transaction(async (tx) => {
      const plan = await this.getOwnedPlan(userId, planId, tx, true);
      if (plan.status === 'archived') throw new ConflictException('Archived plans cannot receive new versions');
      const current = plan.currentVersionId
        ? await tx.select({ versionNumber: planVersions.versionNumber }).from(planVersions)
          .where(and(eq(planVersions.id, plan.currentVersionId), eq(planVersions.planId, planId))).limit(1)
        : [];
      if (plan.currentVersionId && !current[0]) throw new ConflictException('Current version pointer is invalid');
      createdVersion = (current[0]?.versionNumber ?? 0) + 1;
      const resolved = await this.resolveReferences(tx, userId, parsed);
      const now = new Date();
      const versionId = await this.insertVersion(tx, userId, planId, createdVersion, resolved, now);
      await tx.update(plans).set({ currentVersionId: versionId, updatedAt: now }).where(eq(plans.id, planId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'PLAN_VERSION_CREATED', resourceType: 'plan_version', resourceId: versionId, userId, correlationId: planId, causationId: versionId, changeSummary: `Plan ${planId} version ${createdVersion} created`, source: 'api', result: 'success' }, tx);
    });
    return this.getVersion(userId, planId, createdVersion);
  }

  async applyVersion(userId: string, planId: string, versionNumber: number) {
    await this.db.transaction(async (tx) => {
      const plan = await this.getOwnedPlan(userId, planId, tx, true);
      if (plan.status === 'archived') throw new ConflictException('Archived plans cannot apply versions');
      const assembled = await this.assembler.assemble(userId, planId, versionNumber, tx);
      const validated = await this.resolveReferences(tx, userId, assembled.definition);
      const computedHash = definitionHash(validated);
      if (computedHash !== assembled.version.definitionHash || assembled.computedHash !== assembled.version.definitionHash) {
        throw new ConflictException('Plan version integrity check failed');
      }
      await tx.update(plans).set({ activeVersionId: assembled.version.id, updatedAt: new Date() }).where(eq(plans.id, planId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'PLAN_VERSION_APPLIED', resourceType: 'plan', resourceId: planId, userId, correlationId: planId, causationId: assembled.version.id, changeSummary: `Plan ${planId} applied version ${versionNumber}`, source: 'api', result: 'success' }, tx);
    });
    return this.get(userId, planId);
  }

  async changeStatus(userId: string, planId: string, target: PlanState) {
    await this.db.transaction(async (tx) => {
      const plan = await this.getOwnedPlan(userId, planId, tx, true);
      const current = plan.status as PlanState;
      this.stateMachine.assertTransition(current, target);
      if (target === current) return;
      if (target === 'ready') {
        if (!plan.currentVersionId) throw new ConflictException('Plan has no current version');
        await this.validateStoredVersion(tx, userId, planId, plan.currentVersionId);
      }
      if (target === 'active') {
        if (!plan.activeVersionId) throw new ConflictException('Apply a version before activating the plan');
        await this.validateStoredVersion(tx, userId, planId, plan.activeVersionId);
      }
      const now = new Date();
      await tx.update(plans).set({
        status: target,
        archivedAt: target === 'archived' ? now : plan.archivedAt,
        updatedAt: now,
      }).where(eq(plans.id, planId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: `PLAN_STATUS_${target.toUpperCase()}`, resourceType: 'plan', resourceId: planId, userId, correlationId: planId, before: { status: current }, after: { status: target }, changeSummary: `Plan ${planId} moved ${current} -> ${target}`, source: 'api', result: 'success' }, tx);
    });
    return this.get(userId, planId);
  }

  async createVersionFromTemplate(userId: string, planId: string, config: Record<string, unknown> | undefined) {
    let nextVersion = 0;
    let currentTemplateKey: string | null | undefined;
    await this.db.transaction(async (tx) => {
      const plan = await this.getOwnedPlan(userId, planId, tx, true);
      if (!plan.currentVersionId) throw new ConflictException('Plan has no current version');
      const currentRows = await tx.select({
        versionNumber: planVersions.versionNumber,
        templateKey: planVersions.templateKey,
      }).from(planVersions)
        .where(and(eq(planVersions.id, plan.currentVersionId), eq(planVersions.planId, planId)))
        .limit(1);
      const current = currentRows[0];
      if (!current?.templateKey) throw new BadRequestException('This plan is not template-installed');
      currentTemplateKey = current.templateKey;
      let resolvedTemplate;
      try {
        resolvedTemplate = resolvePlanTemplate(current.templateKey, config);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new BadRequestException({ message: 'Invalid template config', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
        }
        throw error;
      }
      if (!resolvedTemplate) throw new NotFoundException('Template not found');
      const definition = this.parse(resolvedTemplate.definition);
      const validated = await this.resolveReferences(tx, userId, definition);
      nextVersion = current.versionNumber + 1;
      const now = new Date();
      const versionId = await this.insertVersion(tx, userId, planId, nextVersion, validated, now, resolvedTemplate.metadata);
      await tx.update(plans).set({ currentVersionId: versionId, updatedAt: now }).where(eq(plans.id, planId));
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'PLAN_VERSION_CREATED_FROM_TEMPLATE',
        resourceType: 'plan_version',
        resourceId: versionId,
        userId,
        correlationId: planId,
        causationId: versionId,
        changeSummary: `Plan ${planId} version ${nextVersion} created from template ${resolvedTemplate.metadata.templateKey}@${resolvedTemplate.metadata.templateVersion}`,
        source: 'api',
        result: 'success',
      }, tx);
    });
    if (!currentTemplateKey) throw new BadRequestException('Template identity is missing');
    return this.getVersion(userId, planId, nextVersion);
  }

  private parse(input: PlanDefinitionInput | PlanDefinition): PlanDefinition {
    try {
      const raw: PlanDefinitionInput = 'schemaVersion' in input ? {
        name: input.name,
        description: input.description,
        domain: input.domain,
        automationLevel: input.automationLevel,
        ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
        sources: input.sources.map((source) => ({
          sourceType: source.sourceType,
          connectorKey: source.connectorKey ?? undefined,
          connectionId: source.connectionId ?? undefined,
          config: source.config,
          sortOrder: source.sortOrder,
        })),
        triggers: input.triggers,
        conditions: input.conditions.map((condition) => ({
          groupId: condition.groupId,
          logicalOperator: condition.logicalOperator,
          fieldPath: condition.fieldPath,
          operator: condition.operator,
          comparisonValue: condition.comparisonValue ?? undefined,
          sortOrder: condition.sortOrder,
        })),
        actions: input.actions.map((action) => ({
          actionType: action.actionType,
          connectorKey: action.connectorKey ?? undefined,
          connectionId: action.connectionId ?? undefined,
          requiredCapability: action.requiredCapability ?? undefined,
          config: action.config,
          stepOrder: action.stepOrder,
        })),
      } : input;
      return normalizePlanDefinition(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ message: 'Invalid plan definition', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
      }
      throw error;
    }
  }

  private async resolveReferences(executor: PlanExecutor, userId: string, definitionInput: PlanDefinitionInput | PlanDefinition): Promise<PlanDefinition> {
    const definition = this.parse(definitionInput);
    const sources = [] as PlanDefinition['sources'];
    for (const source of definition.sources) {
      const reference = await this.resolveConnectorReference(executor, userId, source.connectorKey, source.connectionId);
      if (CONNECTION_REQUIRED_SOURCES.has(source.sourceType) && !reference.connectionId) {
        throw new BadRequestException(`${source.sourceType} sources require a connectionId`);
      }
      sources.push({ ...source, connectorKey: reference.connectorKey, connectionId: reference.connectionId });
    }

    const actions = [] as PlanDefinition['actions'];
    for (const action of definition.actions) {
      const reference = await this.resolveConnectorReference(executor, userId, action.connectorKey, action.connectionId);
      const publishDraftOnlyWithoutProvider = action.actionType === 'publish'
        && !action.requiredCapability
        && !reference.connectionId
        && !reference.connectorId;
      if ((ACTION_DEFINITIONS[action.actionType].externalEffect || action.requiredCapability) && !reference.connectionId && !publishDraftOnlyWithoutProvider) {
        throw new BadRequestException(`${action.actionType} actions with external effects or capabilities require a connectionId`);
      }
      if (action.requiredCapability) {
        if (!reference.connectorId) throw new BadRequestException('Capability has no connector context');
        const capability = await executor.select({ id: connectorCapabilities.id }).from(connectorCapabilities)
          .where(and(eq(connectorCapabilities.connectorId, reference.connectorId), eq(connectorCapabilities.key, action.requiredCapability)))
          .limit(1);
        if (!capability[0]) throw new BadRequestException(`Capability ${action.requiredCapability} does not belong to the referenced connector`);
      }
      actions.push({ ...action, connectorKey: reference.connectorKey, connectionId: reference.connectionId });
    }
    return { ...definition, sources, actions };
  }

  private async resolveConnectorReference(
    executor: PlanExecutor,
    userId: string,
    connectorKey: string | null,
    connectionId: string | null,
  ): Promise<{ connectorId: string | null; connectorKey: string | null; connectionId: string | null }> {
    if (connectionId) {
      const rows = await executor.select({
        connectorId: connections.connectorId,
        connectorKey: connectors.key,
        status: connections.status,
        expiresAt: connections.expiresAt,
      }).from(connections)
        .innerJoin(connectors, eq(connections.connectorId, connectors.id))
        .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
        .limit(1);
      const connection = rows[0];
      if (!connection) throw new BadRequestException('Referenced connection is unavailable');
      if (connection.status === 'revoked' || connection.status === 'error') throw new BadRequestException('Referenced connection is not usable');
      if (connection.expiresAt && connection.expiresAt <= new Date()) throw new BadRequestException('Referenced connection has expired');
      if (connectorKey && connectorKey !== connection.connectorKey) throw new BadRequestException('connectorKey does not match connectionId');
      return { connectorId: connection.connectorId, connectorKey: connection.connectorKey, connectionId };
    }
    if (connectorKey) {
      const rows = await executor.select({ id: connectors.id, key: connectors.key }).from(connectors).where(eq(connectors.key, connectorKey)).limit(1);
      if (!rows[0]) throw new BadRequestException(`Connector ${connectorKey} does not exist`);
      return { connectorId: rows[0].id, connectorKey: rows[0].key, connectionId: null };
    }
    return { connectorId: null, connectorKey: null, connectionId: null };
  }

  private async insertVersion(
    executor: PlanExecutor,
    userId: string,
    planId: string,
    versionNumber: number,
    definition: PlanDefinition,
    now: Date,
    metadata?: TemplateVersionMetadata,
  ): Promise<string> {
    const versionId = newId();
    await executor.insert(planVersions).values({
      id: versionId,
      planId,
      versionNumber,
      name: definition.name,
      description: definition.description,
      domain: definition.domain,
      automationLevel: definition.automationLevel,
      approvalPolicyJson: (definition.approvalPolicy ?? null) as Record<string, unknown> | null,
      templateKey: metadata?.templateKey ?? null,
      templateVersion: metadata?.templateVersion ?? null,
      templateConfigJson: metadata?.templateConfig ?? null,
      definitionHash: definitionHash(definition),
      createdBy: userId,
      createdAt: now,
    });
    for (const source of definition.sources) {
      const connectorId = await this.connectorIdForKey(executor, source.connectorKey);
      await executor.insert(planSources).values({ id: newId(), planVersionId: versionId, sourceType: source.sourceType, connectorId, connectionId: source.connectionId, configJson: source.config, sortOrder: source.sortOrder, createdAt: now });
    }
    for (const trigger of definition.triggers) {
      await executor.insert(planTriggers).values({ id: newId(), planVersionId: versionId, triggerType: trigger.triggerType, configJson: trigger.config, sortOrder: trigger.sortOrder, createdAt: now });
    }
    for (const condition of definition.conditions) {
      await executor.insert(planConditions).values({ id: newId(), planVersionId: versionId, groupId: condition.groupId, logicalOperator: condition.logicalOperator, fieldPath: condition.fieldPath, operator: condition.operator, comparisonValueJson: condition.comparisonValue, sortOrder: condition.sortOrder, createdAt: now });
    }
    for (const action of definition.actions) {
      const connectorId = await this.connectorIdForKey(executor, action.connectorKey);
      await executor.insert(planActions).values({ id: newId(), planVersionId: versionId, actionType: action.actionType, connectorId, connectionId: action.connectionId, requiredCapability: action.requiredCapability, riskLevel: action.riskLevel, configJson: action.config, stepOrder: action.stepOrder, createdAt: now });
    }
    return versionId;
  }

  private async connectorIdForKey(executor: PlanExecutor, key: string | null): Promise<string | null> {
    if (!key) return null;
    const rows = await executor.select({ id: connectors.id }).from(connectors).where(eq(connectors.key, key)).limit(1);
    if (!rows[0]) throw new BadRequestException(`Connector ${key} does not exist`);
    return rows[0].id;
  }

  private async validateStoredVersion(executor: PlanExecutor, userId: string, planId: string, versionId: string) {
    const assembled = await this.assembler.assembleById(userId, planId, versionId, executor);
    const validated = await this.resolveReferences(executor, userId, assembled.definition);
    if (definitionHash(validated) !== assembled.version.definitionHash || assembled.computedHash !== assembled.version.definitionHash) {
      throw new ConflictException('Plan version integrity check failed');
    }
  }

  private async getOwnedPlan(userId: string, planId: string, executor: PlanQueryExecutor = this.db, lock = false) {
    let query = executor.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1);
    if (lock && 'for' in query) query = query.for('update') as typeof query;
    const rows = await query;
    if (!rows[0]) throw new NotFoundException('Plan not found');
    return rows[0];
  }

  private async toResponse(userId: string, plan: typeof plans.$inferSelect) {
    const [current, active] = await Promise.all([
      plan.currentVersionId ? this.versionSummary(userId, plan.id, plan.currentVersionId) : null,
      plan.activeVersionId ? this.versionSummary(userId, plan.id, plan.activeVersionId) : null,
    ]);
    const latestExecution = await this.latestExecutionSummary(userId, plan.id);
    const nextExpectedRunAt = await this.nextExpectedRun(plan.currentVersionId ?? plan.activeVersionId ?? null);
    const summaryVersion = current ?? active;
    const planCenterSummary = summaryVersion
      ? await this.buildPlanCenterSummary(summaryVersion, latestExecution, nextExpectedRunAt)
      : null;
    return {
      id: plan.id,
      status: plan.status,
      currentVersionId: plan.currentVersionId,
      activeVersionId: plan.activeVersionId,
      name: current?.name ?? active?.name ?? null,
      description: current?.description ?? active?.description ?? null,
      templateKey: current?.templateKey ?? active?.templateKey ?? null,
      templateVersion: current?.templateVersion ?? active?.templateVersion ?? null,
      currentVersion: current,
      activeVersion: active,
      latestExecution,
      nextExpectedRunAt,
      planCenterSummary,
      hasMissingConnection: await this.hasMissingConnection(plan.currentVersionId ?? plan.activeVersionId ?? null),
      allowedTransitions: this.stateMachine.allowedTransitions(plan.status as PlanState),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      archivedAt: plan.archivedAt,
    };
  }

  private async versionSummary(userId: string, planId: string, versionId: string) {
    const rows = await this.db.select({
      id: planVersions.id,
      versionNumber: planVersions.versionNumber,
      name: planVersions.name,
      description: planVersions.description,
      domain: planVersions.domain,
      automationLevel: planVersions.automationLevel,
      templateKey: planVersions.templateKey,
      templateVersion: planVersions.templateVersion,
      templateConfig: planVersions.templateConfigJson,
      definitionHash: planVersions.definitionHash,
      createdAt: planVersions.createdAt,
    }).from(planVersions).innerJoin(plans, eq(planVersions.planId, plans.id))
      .where(and(eq(planVersions.id, versionId), eq(planVersions.planId, planId), eq(plans.userId, userId))).limit(1);
    if (!rows[0]) throw new ConflictException('Plan version pointer is invalid');
    return rows[0];
  }

  private async latestExecutionSummary(userId: string, planId: string) {
    const rows = await this.db.select({
      id: executions.id,
      status: executions.status,
      resultSummary: executions.resultSummary,
      finishedAt: executions.finishedAt,
      createdAt: executions.createdAt,
    }).from(executions)
      .where(and(eq(executions.userId, userId), eq(executions.planId, planId)))
      .orderBy(desc(executions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  private async buildPlanCenterSummary(
    version: Awaited<ReturnType<PlansService['versionSummary']>> | null,
    latestExecution: Awaited<ReturnType<PlansService['latestExecutionSummary']>>,
    nextExpectedRunAt: string | null,
  ) {
    if (!version?.templateKey) return null;
    const latestOutputs = latestExecution ? await this.latestExecutionOutputs(latestExecution.id) : [];
    const summarizeOutput = latestOutputs.find((item) => item.actionType === 'summarize')?.output ?? {};
    const preparePurchaseOutput = latestOutputs.find((item) => item.actionType === 'prepare_purchase')?.output ?? {};
    const preparePublishOutput = latestOutputs.find((item) => item.actionType === 'prepare_publish')?.output ?? {};

    if (version.templateKey === 'quiet-delivery-guard') {
      if (!latestExecution) return null;
      return this.buildLogisticsCenterSummary(summarizeOutput, latestExecution, nextExpectedRunAt);
    }

    if (version.templateKey === 'family-supply-reminder') {
      return this.buildHouseholdCenterSummary(version.templateConfig, summarizeOutput, preparePurchaseOutput, nextExpectedRunAt);
    }

    if (version.templateKey === 'video-multi-platform') {
      return this.buildContentCenterSummary(version.templateConfig, preparePublishOutput, latestExecution, nextExpectedRunAt);
    }

    if (version.templateKey === 'daily-important-summary') {
      return this.buildDailySummaryCenterSummary(version.templateConfig, summarizeOutput, latestExecution, nextExpectedRunAt);
    }

    return null;
  }

  private async latestExecutionOutputs(executionId: string) {
    const rows = await this.db.select({
      actionType: planActions.actionType,
      output: executionSteps.outputSnapshotJson,
      stepOrder: executionSteps.stepOrder,
    }).from(executionSteps)
      .innerJoin(planActions, eq(executionSteps.planActionId, planActions.id))
      .where(eq(executionSteps.executionId, executionId))
      .orderBy(asc(executionSteps.stepOrder));
    return rows.map((row) => ({
      actionType: row.actionType,
      output: this.toObjectRecord(row.output),
      stepOrder: row.stepOrder,
    }));
  }

  private buildLogisticsCenterSummary(
    summarizeOutput: Record<string, unknown>,
    latestExecution: NonNullable<Awaited<ReturnType<PlansService['latestExecutionSummary']>>>,
    nextExpectedRunAt: string | null,
  ) {
    const delivered = Boolean(summarizeOutput.delivered);
    const isException = Boolean(summarizeOutput.isException);
    const currentStatus = typeof summarizeOutput.currentStatus === 'string' ? summarizeOutput.currentStatus : 'unknown';
    const currentStatusText = delivered
      ? '已签收'
      : isException
        ? '需要留意'
        : this.logisticsStatusLabel(currentStatus);
    return {
      kind: 'logistics',
      currentStatus: currentStatusText,
      latestCheckAt: latestExecution.finishedAt ?? latestExecution.createdAt,
      nextCheckAt: nextExpectedRunAt,
      isException,
      latestEventSummary: typeof summarizeOutput.latestEventSummary === 'string' ? summarizeOutput.latestEventSummary : null,
      trackingNumberMasked: typeof summarizeOutput.trackingNumberMasked === 'string' ? summarizeOutput.trackingNumberMasked : null,
      carrier: typeof summarizeOutput.carrier === 'string' ? summarizeOutput.carrier : null,
    };
  }

  private buildHouseholdCenterSummary(
    templateConfig: Record<string, unknown> | null,
    summarizeOutput: Record<string, unknown>,
    prepareOutput: Record<string, unknown>,
    nextExpectedRunAt: string | null,
  ) {
    const itemName = typeof summarizeOutput.itemName === 'string'
      ? summarizeOutput.itemName
      : typeof templateConfig?.itemName === 'string'
        ? templateConfig.itemName
        : '该用品';
    const estimatedRunOutAt = typeof summarizeOutput.estimatedRunOutAt === 'string'
      ? summarizeOutput.estimatedRunOutAt
      : this.computeRunOutAt(templateConfig);
    const remindBeforeDays = typeof templateConfig?.remindBeforeDays === 'number' ? templateConfig.remindBeforeDays : 0;
    const nextReminderAt = this.computeReminderAt(estimatedRunOutAt, remindBeforeDays);
    const daysUntilRunOut = typeof summarizeOutput.daysUntilRunOut === 'number'
      ? summarizeOutput.daysUntilRunOut
      : this.computeDaysUntil(estimatedRunOutAt);
    const nearRunOut = typeof summarizeOutput.nearRunOut === 'boolean'
      ? summarizeOutput.nearRunOut
      : nextReminderAt !== null
        ? new Date() >= new Date(nextReminderAt)
        : false;
    const shoppingListPrepared = Boolean(prepareOutput.shoppingListPrepared);
    const currentStatus = nearRunOut
      ? shoppingListPrepared
        ? `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完，已加入补货清单。`
        : `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完。`
      : `${itemName}预计还有 ${Math.max(daysUntilRunOut, 0)} 天。`;
    return {
      kind: 'household',
      currentStatus,
      estimatedRunOutAt,
      nextReminderAt,
      nextCheckAt: nextExpectedRunAt,
      nearRunOut,
      preparationMode: typeof summarizeOutput.preparationMode === 'string'
        ? summarizeOutput.preparationMode
        : typeof templateConfig?.preparationMode === 'string'
          ? templateConfig.preparationMode
          : 'reminder',
      itemName,
    };
  }

  private buildContentCenterSummary(
    templateConfig: Record<string, unknown> | null,
    prepareOutput: Record<string, unknown>,
    latestExecution: Awaited<ReturnType<PlansService['latestExecutionSummary']>>,
    nextExpectedRunAt: string | null,
  ) {
    const targetPlatforms = Array.isArray(templateConfig?.targetPlatforms)
      ? templateConfig.targetPlatforms.filter((item): item is string => typeof item === 'string').map((item) => this.contentPlatformLabel(item))
      : [];
    const waitingConfirmation = typeof prepareOutput.waitingConfirmation === 'boolean'
      ? prepareOutput.waitingConfirmation
      : Boolean(templateConfig?.requireApprovalBeforePublish);
    return {
      kind: 'content',
      currentStatus: latestExecution?.resultSummary ?? '暂未准备发布版本',
      targetPlatforms,
      latestPreparedVariantCount: typeof prepareOutput.preparedVariantsCount === 'number' ? prepareOutput.preparedVariantsCount : 0,
      waitingConfirmation,
      currentStrategy: typeof prepareOutput.currentStrategy === 'string'
        ? prepareOutput.currentStrategy
        : waitingConfirmation
          ? '准备完成后仍需确认'
          : '仅准备草稿',
      nextRunAt: nextExpectedRunAt,
    };
  }

  private buildDailySummaryCenterSummary(
    templateConfig: Record<string, unknown> | null,
    summarizeOutput: Record<string, unknown>,
    latestExecution: Awaited<ReturnType<PlansService['latestExecutionSummary']>>,
    nextExpectedRunAt: string | null,
  ) {
    const includedSources = Array.isArray(templateConfig?.includedSources)
      ? templateConfig.includedSources.filter((item): item is string => typeof item === 'string').map((item) => this.importantSourceLabel(item))
      : [];
    const mustHandleCount = typeof summarizeOutput.mustHandleCount === 'number' ? summarizeOutput.mustHandleCount : 0;
    const shouldHandleCount = typeof summarizeOutput.shouldHandleCount === 'number' ? summarizeOutput.shouldHandleCount : 0;
    return {
      kind: 'daily_summary',
      currentStatus: latestExecution?.resultSummary ?? '暂未生成今日摘要',
      summaryTime: typeof templateConfig?.summaryTime === 'string' ? templateConfig.summaryTime : null,
      includedSources,
      latestSummaryAt: latestExecution?.finishedAt ?? latestExecution?.createdAt ?? null,
      latestImportantCount: mustHandleCount + shouldHandleCount,
      nextSummaryAt: nextExpectedRunAt,
    };
  }

  private async nextExpectedRun(versionId: string | null) {
    if (!versionId) return null;
    const rows = await this.db.select({
      triggerType: planTriggers.triggerType,
      config: planTriggers.configJson,
      sortOrder: planTriggers.sortOrder,
    }).from(planTriggers)
      .where(eq(planTriggers.planVersionId, versionId))
      .orderBy(asc(planTriggers.sortOrder))
      .limit(5);
    const scheduleTrigger = rows.find((row) => row.triggerType === 'schedule' && typeof row.config?.cronExpression === 'string');
    if (!scheduleTrigger || typeof scheduleTrigger.config?.cronExpression !== 'string') return null;
    const next = this.computeNextRun(scheduleTrigger.config.cronExpression, new Date());
    return next?.toISOString() ?? null;
  }

  private async hasMissingConnection(versionId: string | null) {
    if (!versionId) return false;
    const [sources, actions] = await Promise.all([
      this.db.select({ sourceType: planSources.sourceType, connectorId: planSources.connectorId, connectionId: planSources.connectionId }).from(planSources).where(eq(planSources.planVersionId, versionId)),
      this.db.select({ requiredCapability: planActions.requiredCapability, connectorId: planActions.connectorId, connectionId: planActions.connectionId }).from(planActions).where(eq(planActions.planVersionId, versionId)),
    ]);
    if (sources.some((source) => CONNECTION_REQUIRED_SOURCES.has(source.sourceType) && !source.connectionId)) return true;
    return actions.some((action) => (action.requiredCapability || action.connectorId) && !action.connectionId);
  }

  private computeNextRun(cronExpression: string, now: Date) {
    const [minutePart, hourPart, dayPart, monthPart, weekDayPart] = cronExpression.split(/\s+/);
    if (!minutePart || !hourPart || !dayPart || !monthPart || !weekDayPart) return null;
    const minute = this.parseFixedPart(minutePart);
    if (minute === null) return null;
    if (dayPart !== '*' && monthPart === '*' && weekDayPart === '*') {
      const hour = this.parseFixedPart(hourPart);
      const day = Number(dayPart);
      if (hour === null || !Number.isInteger(day)) return null;
      const candidate = new Date(now);
      candidate.setUTCSeconds(0, 0);
      candidate.setUTCMinutes(minute);
      candidate.setUTCHours(hour);
      candidate.setUTCDate(day);
      if (candidate <= now) candidate.setUTCMonth(candidate.getUTCMonth() + 1, day);
      return candidate;
    }
    if (dayPart === '*' && monthPart === '*' && weekDayPart === '*') {
      const everyHours = this.parseEveryPart(hourPart);
      if (everyHours !== null) {
        const candidate = new Date(now);
        candidate.setUTCSeconds(0, 0);
        candidate.setUTCMinutes(minute);
        const currentHour = candidate.getUTCHours();
        const currentMinute = candidate.getUTCMinutes();
        let nextHour = Math.ceil(currentHour / everyHours) * everyHours;
        if (currentHour % everyHours === 0 && minute > currentMinute) nextHour = currentHour;
        if (currentHour % everyHours === 0 && minute <= currentMinute) nextHour = currentHour + everyHours;
        if (currentHour % everyHours !== 0 && nextHour === currentHour) nextHour += everyHours;
        if (nextHour >= 24) {
          candidate.setUTCDate(candidate.getUTCDate() + Math.floor(nextHour / 24));
          nextHour %= 24;
        }
        candidate.setUTCHours(nextHour);
        return candidate;
      }
      const hour = this.parseFixedPart(hourPart);
      if (hour === null) return null;
      const candidate = new Date(now);
      candidate.setUTCSeconds(0, 0);
      candidate.setUTCMinutes(minute);
      candidate.setUTCHours(hour);
      if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
      return candidate;
    }
    if (dayPart === '*' && monthPart === '*' && /^[0-6]$/.test(weekDayPart)) {
      const hour = this.parseFixedPart(hourPart);
      const weekday = Number(weekDayPart);
      if (hour === null) return null;
      const candidate = new Date(now);
      candidate.setUTCSeconds(0, 0);
      candidate.setUTCMinutes(minute);
      candidate.setUTCHours(hour);
      const delta = (weekday - candidate.getUTCDay() + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() + delta);
      if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
      return candidate;
    }
    return null;
  }

  private parseFixedPart(part: string) {
    const value = Number(part);
    return Number.isInteger(value) ? value : null;
  }

  private parseEveryPart(part: string) {
    const match = /^\*\/(\d+)$/.exec(part);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  private toObjectRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private logisticsStatusLabel(status: string) {
    switch (status) {
      case 'created':
        return '等待揽收';
      case 'in_transit':
        return '运输中';
      case 'out_for_delivery':
        return '派送中';
      case 'delivered':
        return '已签收';
      case 'exception':
        return '需要留意';
      default:
        return '暂未检查';
    }
  }

  private contentPlatformLabel(platform: string) {
    switch (platform) {
      case 'douyin':
        return '抖音';
      case 'bilibili':
        return 'B站';
      default:
        return platform;
    }
  }

  private importantSourceLabel(sourceType: string) {
    switch (sourceType) {
      case 'internal_task':
        return '内部事项';
      case 'manual_event':
        return '手动事件';
      case 'test_email':
        return '测试邮件';
      case 'test_calendar':
        return '测试日历';
      default:
        return sourceType;
    }
  }

  private computeRunOutAt(config: Record<string, unknown> | null) {
    if (!config) return null;
    if (typeof config.lastPurchasedAt !== 'string' || typeof config.estimatedUsageDays !== 'number') return null;
    const date = new Date(config.lastPurchasedAt);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + config.estimatedUsageDays);
    return date.toISOString();
  }

  private computeReminderAt(estimatedRunOutAt: string | null, remindBeforeDays: number) {
    if (!estimatedRunOutAt) return null;
    const date = new Date(estimatedRunOutAt);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - remindBeforeDays);
    return date.toISOString();
  }

  private computeDaysUntil(estimatedRunOutAt: string | null) {
    if (!estimatedRunOutAt) return 0;
    const date = new Date(estimatedRunOutAt);
    if (Number.isNaN(date.getTime())) return 0;
    return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
}
