import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  FACT_SCHEMA_CATALOG, RESOURCE_CATALOG, SCENARIO_DEFINITIONS, STRATEGY_PROFILES, catalogHash,
  compileScenarioPlan, evaluateScenarioReadiness, scenarioByKey, scenarioByRevision, scenarioDefinitionByKey, PRODUCT_DOMAINS,
  scenarioContractV2ByKey,
  type StrategyKey, type TerminalHandoffTarget,
  TERMINAL_FOLLOW_UP_RULES, terminalFollowUpScenario,
} from '@lazy-armor/plan-schema';
import {
  connections, factSchemaDefinitions, resourceCatalogDefinitions, scenarioDefinitions, strategyProfileDefinitions,
} from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { ReadinessEvidenceService } from './readiness-evidence.service';

@Injectable()
export class RuntimeCatalogRegistryService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly capabilityUsability: CapabilityUsabilityService,
    private readonly evidence: ReadinessEvidenceService,
  ) {}

  async onModuleInit() { await this.sync(); }

  listDomains() { return PRODUCT_DOMAINS.map((domain) => ({ ...domain, scenarioCount: SCENARIO_DEFINITIONS.filter((item) => item.domain === domain.key).length })); }
  listScenarios(domain?: string) { return domain ? SCENARIO_DEFINITIONS.filter((item) => item.domain === domain) : SCENARIO_DEFINITIONS; }
  getScenario(key: string) { const value = scenarioDefinitionByKey(key); if (!value) throw new NotFoundException('Scenario not found'); return value; }
  getScenarioContractV2(key: string) {
    this.getScenario(key);
    const value = scenarioContractV2ByKey(key);
    if (!value) throw new NotFoundException('Scenario Contract V2 not available');
    return value;
  }
  listResources() { return RESOURCE_CATALOG; }
  factsForResource(resourceType: string) {
    if (!RESOURCE_CATALOG.some((item) => item.key === resourceType)) throw new NotFoundException('Resource not found');
    return FACT_SCHEMA_CATALOG.filter((item) => item.resourceType === resourceType);
  }
  listStrategies() { return STRATEGY_PROFILES; }
  getStrategy(key: string) {
    const strategy = STRATEGY_PROFILES.find((item) => item.key === key);
    if (!strategy) throw new NotFoundException('Strategy not found');
    return strategy;
  }

  async readiness(userId: string, key: string) {
    const scenario = this.getScenario(key);
    const projected = await this.evidence.project(userId, scenario, await this.resolveUsableCapabilities(userId));
    return evaluateScenarioReadiness(scenario, projected.input);
  }

  async compile(userId: string, key: string, input: { scenarioRevision?: number; strategy?: StrategyKey; name?: string; subjectKey?: string; target?: TerminalHandoffTarget }) {
    try {
      const scenario = scenarioByRevision(key, input.scenarioRevision ?? this.getScenario(key).revision);
      const readiness = scenario
        ? (await this.evidence.project(userId, scenario, await this.resolveUsableCapabilities(userId))).input
        : undefined;
      return compileScenarioPlan({ scenarioKey: key, scenarioRevision: input.scenarioRevision, strategy: input.strategy, name: input.name, subjectKey: input.subjectKey, target: input.target, mode: 'DRAFT', readiness });
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Scenario compilation failed'); }
  }

  private async resolveUsableCapabilities(userId: string) {
    const rows = await this.db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
    const resolved = await Promise.all(rows.map((row) => this.capabilityUsability.resolveConnection(userId, row.id)));
    return resolved.flatMap((connection) => connection.capabilities.filter((item) => item.usable).map((item) => item.key));
  }

  async sync() {
    for (const item of RESOURCE_CATALOG) await this.syncResource(item);
    for (const item of FACT_SCHEMA_CATALOG) await this.syncFact(item);
    for (const item of STRATEGY_PROFILES) await this.syncStrategy(item);
    for (const item of SCENARIO_DEFINITIONS) await this.syncScenario(item);
    for (const rule of TERMINAL_FOLLOW_UP_RULES) await this.syncScenario(terminalFollowUpScenario(rule));
  }

  private async syncResource(item: typeof RESOURCE_CATALOG[number]) {
    const hash = catalogHash(item);
    const old = (await this.db.select({ hash: resourceCatalogDefinitions.definitionHash }).from(resourceCatalogDefinitions).where(and(eq(resourceCatalogDefinitions.resourceKey, item.key), eq(resourceCatalogDefinitions.revision, item.revision))).limit(1))[0];
    if (old) { if (old.hash !== hash) throw new Error(`Resource revision is immutable: ${item.key}@${item.revision}`); return; }
    await this.db.insert(resourceCatalogDefinitions).values({ id: newId(), resourceKey: item.key, schemaVersion: item.schemaVersion, revision: item.revision, definitionHash: hash, status: item.status, definitionJson: item as unknown as Record<string, unknown>, supersededAt: null, createdAt: new Date() });
  }
  private async syncFact(item: typeof FACT_SCHEMA_CATALOG[number]) {
    const hash = catalogHash(item);
    const old = (await this.db.select({ hash: factSchemaDefinitions.definitionHash }).from(factSchemaDefinitions).where(and(eq(factSchemaDefinitions.factKey, item.key), eq(factSchemaDefinitions.revision, item.revision))).limit(1))[0];
    if (old) { if (old.hash !== hash) throw new Error(`Fact schema revision is immutable: ${item.key}@${item.revision}`); return; }
    await this.db.insert(factSchemaDefinitions).values({ id: newId(), factKey: item.key, resourceKey: item.resourceType, schemaVersion: item.schemaVersion, revision: item.revision, definitionHash: hash, status: item.status, definitionJson: item as unknown as Record<string, unknown>, supersededAt: null, createdAt: new Date() });
  }
  private async syncStrategy(item: typeof STRATEGY_PROFILES[number]) {
    const hash = catalogHash(item);
    const old = (await this.db.select({ hash: strategyProfileDefinitions.definitionHash }).from(strategyProfileDefinitions).where(and(eq(strategyProfileDefinitions.strategyKey, item.key), eq(strategyProfileDefinitions.revision, item.revision))).limit(1))[0];
    if (old) { if (old.hash !== hash) throw new Error(`Strategy revision is immutable: ${item.key}@${item.revision}`); return; }
    await this.db.insert(strategyProfileDefinitions).values({ id: newId(), strategyKey: item.key, schemaVersion: item.schemaVersion, revision: item.revision, definitionHash: hash, status: item.status, definitionJson: item as unknown as Record<string, unknown>, supersededAt: null, createdAt: new Date() });
  }
  private async syncScenario(item: typeof SCENARIO_DEFINITIONS[number]) {
    const hash = catalogHash(item);
    const old = (await this.db.select({ hash: scenarioDefinitions.definitionHash }).from(scenarioDefinitions).where(and(eq(scenarioDefinitions.scenarioKey, item.key), eq(scenarioDefinitions.revision, item.revision))).limit(1))[0];
    if (old) { if (old.hash !== hash) throw new Error(`Scenario revision is immutable: ${item.key}@${item.revision}`); return; }
    await this.db.insert(scenarioDefinitions).values({ id: newId(), scenarioKey: item.key, domainKey: item.domain, schemaVersion: item.schemaVersion, revision: item.revision, definitionHash: hash, status: item.status, definitionJson: item as unknown as Record<string, unknown>, supersededAt: null, createdAt: new Date() });
  }
}
