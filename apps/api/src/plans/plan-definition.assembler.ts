import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { connectors, planActions, planConditions, planSources, planTriggers, planVersions, plans } from '@lazy-armor/database';
import { definitionHash, normalizePlanDefinition, type ApprovalPolicyDefinition, type PlanDefinition } from '@lazy-armor/plan-schema';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export type PlanQueryExecutor = Pick<InjectedDatabase, 'select'>;

@Injectable()
export class PlanDefinitionAssembler {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async assemble(userId: string, planId: string, versionNumber: number, executor: PlanQueryExecutor = this.db) {
    const rows = await executor.select({
      id: planVersions.id,
      planId: planVersions.planId,
      versionNumber: planVersions.versionNumber,
      name: planVersions.name,
      description: planVersions.description,
      domain: planVersions.domain,
      automationLevel: planVersions.automationLevel,
      approvalPolicyJson: planVersions.approvalPolicyJson,
      templateKey: planVersions.templateKey,
      templateVersion: planVersions.templateVersion,
      templateConfigJson: planVersions.templateConfigJson,
      definitionHash: planVersions.definitionHash,
      createdBy: planVersions.createdBy,
      createdAt: planVersions.createdAt,
    }).from(planVersions)
      .innerJoin(plans, eq(planVersions.planId, plans.id))
      .where(and(eq(plans.userId, userId), eq(plans.id, planId), eq(planVersions.versionNumber, versionNumber)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Plan version not found');
    return this.assembleVersion(rows[0], executor);
  }

  async assembleById(userId: string, planId: string, versionId: string, executor: PlanQueryExecutor = this.db) {
    const rows = await executor.select({
      id: planVersions.id,
      planId: planVersions.planId,
      versionNumber: planVersions.versionNumber,
      name: planVersions.name,
      description: planVersions.description,
      domain: planVersions.domain,
      automationLevel: planVersions.automationLevel,
      approvalPolicyJson: planVersions.approvalPolicyJson,
      templateKey: planVersions.templateKey,
      templateVersion: planVersions.templateVersion,
      templateConfigJson: planVersions.templateConfigJson,
      definitionHash: planVersions.definitionHash,
      createdBy: planVersions.createdBy,
      createdAt: planVersions.createdAt,
    }).from(planVersions)
      .innerJoin(plans, eq(planVersions.planId, plans.id))
      .where(and(eq(plans.userId, userId), eq(plans.id, planId), eq(planVersions.id, versionId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Plan version not found');
    return this.assembleVersion(rows[0], executor);
  }

  private async assembleVersion(version: {
    id: string;
    planId: string;
    versionNumber: number;
    name: string;
    description: string | null;
    domain: string;
    automationLevel: string;
    approvalPolicyJson: Record<string, unknown> | null;
    templateKey: string | null;
    templateVersion: string | null;
    templateConfigJson: Record<string, unknown> | null;
    definitionHash: string;
    createdBy: string;
    createdAt: Date;
  }, executor: PlanQueryExecutor): Promise<{ version: typeof version; definition: PlanDefinition; computedHash: string }> {
    const sourceRows = await executor.select({
      sourceType: planSources.sourceType,
      connectorKey: connectors.key,
      connectionId: planSources.connectionId,
      config: planSources.configJson,
      sortOrder: planSources.sortOrder,
    }).from(planSources)
      .leftJoin(connectors, eq(planSources.connectorId, connectors.id))
      .where(eq(planSources.planVersionId, version.id))
      .orderBy(asc(planSources.sortOrder));
    const triggerRows = await executor.select({
      triggerType: planTriggers.triggerType,
      config: planTriggers.configJson,
      sortOrder: planTriggers.sortOrder,
    }).from(planTriggers)
      .where(eq(planTriggers.planVersionId, version.id))
      .orderBy(asc(planTriggers.sortOrder));
    const conditionRows = await executor.select({
      groupId: planConditions.groupId,
      logicalOperator: planConditions.logicalOperator,
      fieldPath: planConditions.fieldPath,
      operator: planConditions.operator,
      comparisonValue: planConditions.comparisonValueJson,
      sortOrder: planConditions.sortOrder,
    }).from(planConditions)
      .where(eq(planConditions.planVersionId, version.id))
      .orderBy(asc(planConditions.sortOrder));
    const actionRows = await executor.select({
      actionType: planActions.actionType,
      connectorKey: connectors.key,
      connectionId: planActions.connectionId,
      requiredCapability: planActions.requiredCapability,
      riskLevel: planActions.riskLevel,
      config: planActions.configJson,
      stepOrder: planActions.stepOrder,
    }).from(planActions)
      .leftJoin(connectors, eq(planActions.connectorId, connectors.id))
      .where(eq(planActions.planVersionId, version.id))
      .orderBy(asc(planActions.stepOrder));

    const definition = normalizePlanDefinition({
      name: version.name,
      description: version.description,
      domain: version.domain as PlanDefinition['domain'],
      automationLevel: version.automationLevel as PlanDefinition['automationLevel'],
      ...(version.approvalPolicyJson ? { approvalPolicy: version.approvalPolicyJson as unknown as ApprovalPolicyDefinition } : {}),
      sources: sourceRows.map((row) => ({
        sourceType: row.sourceType as PlanDefinition['sources'][number]['sourceType'],
        connectorKey: row.connectorKey ?? undefined,
        connectionId: row.connectionId ?? undefined,
        config: row.config as PlanDefinition['sources'][number]['config'],
        sortOrder: row.sortOrder,
      })),
      triggers: triggerRows.map((row) => ({
        triggerType: row.triggerType as PlanDefinition['triggers'][number]['triggerType'],
        config: row.config as PlanDefinition['triggers'][number]['config'],
        sortOrder: row.sortOrder,
      })),
      conditions: conditionRows.map((row) => ({
        groupId: row.groupId,
        logicalOperator: row.logicalOperator as 'AND' | 'OR',
        fieldPath: row.fieldPath,
        operator: row.operator as PlanDefinition['conditions'][number]['operator'],
        comparisonValue: row.comparisonValue === null ? undefined : row.comparisonValue as PlanDefinition['conditions'][number]['comparisonValue'],
        sortOrder: row.sortOrder,
      })),
      actions: actionRows.map((row) => ({
        actionType: row.actionType as PlanDefinition['actions'][number]['actionType'],
        connectorKey: row.connectorKey ?? undefined,
        connectionId: row.connectionId ?? undefined,
        requiredCapability: row.requiredCapability ?? undefined,
        config: row.config as PlanDefinition['actions'][number]['config'],
        stepOrder: row.stepOrder,
      })),
    });
    return { version, definition, computedHash: definitionHash(definition) };
  }
}
