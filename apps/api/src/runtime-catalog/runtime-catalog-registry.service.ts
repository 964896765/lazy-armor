import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  FACT_SCHEMA_CATALOG, RESOURCE_CATALOG, SCENARIO_DEFINITIONS, STRATEGY_PROFILES, catalogHash,
  compileScenarioPlan, evaluateScenarioReadiness, scenarioByKey, PRODUCT_DOMAINS,
  type StrategyKey,
} from '@lazy-armor/plan-schema';
import {
  connections, factSchemaDefinitions, resourceCatalogDefinitions, scenarioDefinitions, strategyProfileDefinitions,
} from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';

@Injectable()
export class RuntimeCatalogRegistryService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly capabilityUsability: CapabilityUsabilityService,
  ) {}

  async onModuleInit() { await this.sync(); }

  listDomains() { return PRODUCT_DOMAINS.map((domain) => ({ ...domain, scenarioCount: SCENARIO_DEFINITIONS.filter((item) => item.domain === domain.key).length })); }
  listScenarios(domain?: string) { return domain ? SCENARIO_DEFINITIONS.filter((item) => item.domain === domain) : SCENARIO_DEFINITIONS; }
  getScenario(key: string) { const value = scenarioByKey(key); if (!value) throw new NotFoundException('Scenario not found'); return value; }
  listResources() { return RESOURCE_CATALOG; }
  factsForResource(resourceType: string) {
    if (!RESOURCE_CATALOG.some((item) => item.key === resourceType)) throw new NotFoundException('Resource not found');
    return FACT_SCHEMA_CATALOG.filter((item) => item.resourceType === resourceType);
  }
  listStrategies() { return STRATEGY_PROFILES; }

  async readiness(userId: string, key: string) {
    const scenario = this.getScenario(key);
    const rows = await this.db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
    const resolved = await Promise.all(rows.map((row) => this.capabilityUsability.resolveConnection(userId, row.id)));
    const usableCapabilities = resolved.flatMap((connection) => connection.capabilities.filter((item) => item.usable).map((item) => item.key));
    return evaluateScenarioReadiness(scenario, {
      usableCapabilities,
      availableFacts: [],
      manualInputAvailable: true,
      observationPipelineAvailable: false,
      executionPipelineAvailable: true,
      providerBlocked: resolved.length > 0 && usableCapabilities.length === 0,
    });
  }

  async compile(userId: string, key: string, input: { strategy?: StrategyKey; name?: string; subjectKey?: string }) {
    const readiness = await this.readiness(userId, key);
    return compileScenarioPlan({ scenarioKey: key, strategy: input.strategy, name: input.name, subjectKey: input.subjectKey, mode: 'DRAFT', readiness: {
      manualInputAvailable: readiness.state === 'MANUAL_READY',
      observationPipelineAvailable: false,
      executionPipelineAvailable: true,
    } });
  }

  async sync() {
    for (const item of RESOURCE_CATALOG) await this.syncResource(item);
    for (const item of FACT_SCHEMA_CATALOG) await this.syncFact(item);
    for (const item of STRATEGY_PROFILES) await this.syncStrategy(item);
    for (const item of SCENARIO_DEFINITIONS) await this.syncScenario(item);
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
