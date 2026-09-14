import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, connectors, credentialRefs,
  plans, planVersions, providerCapabilityHealth, providerCapabilityManifests, scenarioDefinitions,
  strategyRuntimeBindings, strategyRuntimeDecisions, strategyRuntimeWakeups, truthFactDependencies, truthRecords, truthRecordVersions, users } from '@lazy-armor/database';
import { validateProviderCapabilityManifest, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { buildTerminalFollowUpRuntime, catalogHash, compileScenarioPlan, definitionHash, evaluateConditionAst,
  realityValueHash, terminalFollowUpRule, terminalFollowUpScenario, type CompiledStrategyRuntime } from '@lazy-armor/plan-schema';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';

export type HandoffTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
export interface TerminalHandoffProof {
  schema: 'terminal-handoff.v1'; wakeupId: string; bindingId: string; decisionId: string; decisionHash: string;
  planVersionId: string; definitionHash: string; runtimeHash: string; truthVersionId: string; truthValueHash: string;
  connectionId: string; authRefId: string; authVersion: number; capabilityKey: string; subjectKey: string;
}

// Shared authorization boundary only. Risk/Approval/Execution remain owned by the existing Runner.
@Injectable()
export class TerminalHandoffGuard {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider) {}

  async lock(userId: string, planId: string, wakeupId: string, tx: HandoffTransaction, expected?: TerminalHandoffProof) {
    let boundary = 'PLAN';
    const reject = (): never => { throw new ForbiddenException({ code: 'TERMINAL_HANDOFF_NOT_AUTHORIZED', message: `Terminal handoff denied: ${boundary}` }); };
    const plan = (await tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1).for('update'))[0];
    if (!plan || plan.status !== 'active' || !plan.activeVersionId) return reject();
    boundary = 'REGISTERED_RULE';
    const wakeup = (await tx.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.id, wakeupId),
      eq(strategyRuntimeWakeups.userId, userId), eq(strategyRuntimeWakeups.planVersionId, plan.activeVersionId))).limit(1).for('update'))[0];
    const binding = wakeup && (await tx.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.id, wakeup.bindingId),
      eq(strategyRuntimeBindings.userId, userId), eq(strategyRuntimeBindings.planVersionId, plan.activeVersionId))).limit(1))[0];
    const rule = binding && terminalFollowUpRule(binding.scenarioKey, binding.scenarioRevision);
    if (!wakeup || !binding || !rule || binding.strategyKey !== 'SILENT_FOLLOW_UP'
      || wakeup.factKey !== rule.factKey || wakeup.resourceType !== rule.resourceType || wakeup.triggerMode !== 'FACT_CHANGED') return reject();
    let runtime: CompiledStrategyRuntime;
    try { runtime = buildTerminalFollowUpRuntime(rule, wakeup.subjectKey); } catch { return reject(); }
    if (binding.runtimeHash !== runtime.runtimeHash || catalogHash(binding.runtimeJson) !== catalogHash(runtime)) return reject();
    boundary = 'SCENARIO_PLAN_INTEGRITY';
    const scenario = (await tx.select().from(scenarioDefinitions).where(and(eq(scenarioDefinitions.scenarioKey, rule.scenarioKey),
      eq(scenarioDefinitions.revision, rule.scenarioRevision))).limit(1))[0];
    const version = (await tx.select().from(planVersions).where(eq(planVersions.id, plan.activeVersionId)).limit(1))[0];
    if (!scenario || scenario.definitionHash !== catalogHash(terminalFollowUpScenario(rule)) || !version
      || version.definitionHash !== definitionHash(compileScenarioPlan({ scenarioKey: rule.scenarioKey, scenarioRevision: rule.scenarioRevision,
        name: version.name, subjectKey: wakeup.subjectKey, mode: 'DRAFT' }).definition)) return reject();
    boundary = 'DEPENDENCY_DECISION_INTEGRITY';
    const index = (await tx.select().from(truthFactDependencies).where(and(eq(truthFactDependencies.bindingId, binding.id),
      eq(truthFactDependencies.userId, userId), eq(truthFactDependencies.planVersionId, version.id), eq(truthFactDependencies.factKey, rule.factKey),
      eq(truthFactDependencies.resourceType, rule.resourceType), eq(truthFactDependencies.field, rule.field),
      eq(truthFactDependencies.scope, 'EXACT_SUBJECT'), eq(truthFactDependencies.subjectKey, wakeup.subjectKey))).limit(1))[0];
    const decision = (await tx.select().from(strategyRuntimeDecisions).where(and(eq(strategyRuntimeDecisions.wakeupId, wakeupId),
      eq(strategyRuntimeDecisions.bindingId, binding.id), eq(strategyRuntimeDecisions.userId, userId))).limit(1))[0];
    if (!index || index.dependencyKey !== catalogHash({ planVersionId: version.id, ...runtime.dependencies[0] })
      || !decision || decision.result !== 'READY_FOR_PLAN_ENGINE' || decision.conditionDecisionJson.result !== true
      || decision.decisionHash !== catalogHash({ inputHash: decision.inputHash, triggerDecision: decision.triggerDecisionJson,
        conditionDecision: decision.conditionDecisionJson, lifecycleTrace: decision.lifecycleTraceJson, result: decision.result })) return reject();
    boundary = 'CONNECTION';
    const [connectionId, repositoryId, , resourceId] = wakeup.subjectKey.split(':');
    const owned = (await tx.select({ connection: connections, provider: connectors.key, userStatus: users.status }).from(connections)
      .innerJoin(connectors, eq(connectors.id, connections.connectorId)).innerJoin(users, eq(users.id, connections.userId))
      .where(and(eq(connections.id, connectionId!), eq(connections.userId, userId))).limit(1).for('update'))[0];
    if (!owned || owned.provider !== 'github' || owned.userStatus !== 'active' || owned.connection.status !== 'connected'
      || !owned.connection.credentialRefId) return reject();
    boundary = 'READ_AUTHORIZATION';
    const permission = (await tx.select({ permission: connectionPermissions, capability: connectorCapabilities }).from(connectionPermissions)
      .innerJoin(connectorCapabilities, eq(connectorCapabilities.id, connectionPermissions.connectorCapabilityId))
      .where(and(eq(connectionPermissions.connectionId, connectionId!), eq(connectorCapabilities.key, rule.capabilityKey))).limit(1).for('update'))[0];
    const grant = (await tx.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, connectionId!),
      eq(connectionCapabilityGrants.capabilityKey, rule.capabilityKey))).limit(1).for('update'))[0];
    const credential = (await tx.select().from(credentialRefs).where(eq(credentialRefs.id, owned.connection.credentialRefId)).limit(1).for('update'))[0];
    const health = (await tx.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, connectionId!),
      eq(providerCapabilityHealth.capabilityKey, rule.capabilityKey))).limit(1).for('update'))[0];
    const manifestRow = (await tx.select().from(providerCapabilityManifests).where(and(eq(providerCapabilityManifests.providerKey, 'github'),
      eq(providerCapabilityManifests.status, 'ACTIVE'))).limit(1).for('update'))[0];
    if (!permission || permission.capability.connectorId !== owned.connection.connectorId || permission.capability.operation !== 'read'
      || permission.permission.granted !== 1 || permission.permission.revokedAt || !grant || grant.providerKey !== 'github'
      || grant.status !== 'GRANTED' || grant.revokedAt || !grant.grantedScopesJson.includes('repo')
      || !credential || credential.status !== 'active'
      || !health || health.providerKey !== 'github' || health.status !== 'HEALTHY' || !health.validUntil || !manifestRow) return reject();
    boundary = 'CREDENTIAL_REPOSITORY';
    let secret;
    try {
      const store = await this.credentials.health();
      if (store.status !== 'ok' || store.provider !== credential.provider) return reject();
      secret = await this.credentials.get(credential.ref, credential.currentVersion);
    } catch { return reject(); }
    let repositories: unknown;
    try { repositories = JSON.parse(secret.repositories); } catch { return reject(); }
    if (secret.tokenMode !== 'OAUTH_APP' || !secret.accessToken || !secret.scopes?.split(/[ ,]+/).includes('repo')
      || !Array.isArray(repositories) || !repositories.some((repo) => repo?.id === Number(repositoryId))) return reject();
    boundary = 'MANIFEST_DATA_BOUNDARY';
    let manifest;
    try { manifest = validateProviderCapabilityManifest(manifestRow.manifestJson as unknown as ProviderCapabilityManifest); } catch { return reject(); }
    const capability = manifest.capabilities.find((item) => item.key === rule.capabilityKey);
    if (!capability || !capability.sourceModes.includes('OFFICIAL_API') || capability.operation !== 'read'
      || !['BETA', 'PRODUCTION'].includes(capability.implementationStatus) || capability.officialAvailability !== 'AVAILABLE'
      || capability.reviewStatus !== 'VERIFIED' || !['beta', 'production'].includes(capability.providerAvailability ?? 'disabled')
      || !capability.oauthScopes.every((scope) => grant.grantedScopesJson.includes(scope))
      || !capability.dataBoundary.resources.includes(rule.resourceType) || !capability.dataBoundary.readableFields.includes(rule.field)
      || !capability.dataBoundary.purpose.includes('user_authorized_repository_automation') || manifest.providerReview !== 'VERIFIED') return reject();
    boundary = 'CURRENT_TRUTH';
    const truth = (await tx.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecordVersions)
      .innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, userId)))
      .where(eq(truthRecordVersions.id, wakeup.truthRecordVersionId)).limit(1).for('update'))[0];
    if (!truth || truth.record.status !== 'verified' || truth.record.revokedAt || truth.record.currentVersionId !== truth.version.id
      || truth.record.verifiedBy !== 'authenticated_provider_read' || truth.version.verificationMethod !== 'READ_BACK'
      || truth.record.subjectKey !== wakeup.subjectKey || truth.version.valueHash !== realityValueHash(truth.version.valueJson)) return reject();
    boundary = 'SOURCE_READ_FENCE';
    const value = truth.version.valueJson;
    const payload = value.value as Record<string, unknown> | undefined;
    const fence = truth.record.sourceReadFenceJson;
    if (value.realityLevel !== 'VERIFIED' || value.confidence !== 1 || value.factKey !== rule.factKey || value.resourceType !== rule.resourceType
      || value.subjectKey !== wakeup.subjectKey || !payload || payload.resourceId !== resourceId || payload.repositoryId !== Number(repositoryId)
      || fence?.connectionId !== connectionId || fence.credentialRefId !== credential.id
      || fence.credentialVersion !== credential.currentVersion || fence.capabilityKey !== rule.capabilityKey) return reject();
    boundary = 'TERMINAL_CONDITION';
    const previous = (await tx.select().from(truthRecordVersions).where(and(eq(truthRecordVersions.truthRecordId, truth.record.id),
      lt(truthRecordVersions.versionNumber, truth.version.versionNumber))).orderBy(desc(truthRecordVersions.versionNumber)).limit(1))[0];
    const previousPayload = previous?.valueJson.value as Record<string, unknown> | undefined;
    const condition = evaluateConditionAst(runtime.conditionAst, { facts: { [rule.factKey]: { value: payload[rule.field],
      ...(previousPayload ? { previousValue: previousPayload[rule.field] } : {}), truthVersionId: truth.version.id,
      verifiedAt: truth.record.verifiedAt.toISOString() } }, evaluatedAt: new Date().toISOString() });
    if (!condition.result || catalogHash(condition.truthVersionIds) !== catalogHash(decision.conditionDecisionJson.truthVersionIds)
      || catalogHash(condition.evaluatedInputValues) !== catalogHash(decision.conditionDecisionJson.evaluatedInputValues)) return reject();
    const proof: TerminalHandoffProof = { schema: 'terminal-handoff.v1', wakeupId, bindingId: binding.id, decisionId: decision.id,
      decisionHash: decision.decisionHash, planVersionId: version.id, definitionHash: version.definitionHash, runtimeHash: runtime.runtimeHash,
      truthVersionId: truth.version.id, truthValueHash: truth.version.valueHash, connectionId: connectionId!, authRefId: credential.id,
      authVersion: credential.currentVersion, capabilityKey: rule.capabilityKey, subjectKey: wakeup.subjectKey };
    if (expected && catalogHash(expected) !== catalogHash(proof)) return reject();
    const assertCurrent = () => {
      boundary = 'FRESHNESS_AUTHORIZATION_DEADLINE';
      const now = new Date();
      if (health.checkedAt > now || health.validUntil! <= now || truth.record.verifiedAt > now
        || now.getTime() - truth.record.verifiedAt.getTime() > 300_000
        || [owned.connection.expiresAt, permission.permission.expiresAt, grant.expiresAt, credential.expiresAt].some((expiry) => expiry && expiry <= now)) reject();
    };
    assertCurrent();
    const summary = rule.resourceType === 'PullRequest' ? `PR #${payload.number} 已合并` : `Workflow ${resourceId} 已完成：${payload.conclusion ?? '未知结论'}`;
    const [root, leaf] = rule.factKey.split('.');
    return { proof, assertCurrent, triggerPayload: { [root!]: { [leaf!]: payload }, humanSummary: summary, resultSummary: summary,
      notificationEventType: 'github_terminal_follow_up', notificationDedupeKey: `strategy:${binding.id}:${truth.record.id}:terminal`, notificationPriority: 'P2' } };
  }
}
