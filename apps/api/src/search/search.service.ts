import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { executions, notifications, plans, planVersions } from '@lazy-armor/database';
import { SCENARIO_DEFINITIONS, type ScenarioDefinition } from '@lazy-armor/plan-schema';
import { and, desc, eq, inArray, like, ne, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export interface SearchPlanHit {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
}

export interface SearchScenarioHit {
  key: string;
  domain: string;
  label: string;
}

export interface SearchExecutionHit {
  id: string;
  planId: string;
  planName: string | null;
  status: string;
  resultSummary: string | null;
  createdAt: Date;
}

export interface SearchNotificationHit {
  id: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  createdAt: Date;
}

export interface SearchResults {
  plans: SearchPlanHit[];
  scenarios: SearchScenarioHit[];
  executions: SearchExecutionHit[];
  notifications: SearchNotificationHit[];
}

const MAX_RESULTS = 20;

@Injectable()
export class SearchService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  /**
   * Read-only cross-entity search, strictly scoped to the authenticated user.
   * Never calls the agent model; only matches stored, user-owned rows and the
   * static canonical scenario catalog.
   */
  async search(userId: string, query: string): Promise<SearchResults> {
    const needle = (query ?? '').trim();
    if (!needle) throw new BadRequestException('Search query is required');
    const lowered = needle.toLocaleLowerCase('zh-CN');

    const [planHits, scenarioHits, executionHits, notificationHits] = await Promise.all([
      this.searchPlans(userId, lowered),
      this.searchScenarios(lowered),
      this.searchExecutions(userId, lowered),
      this.searchNotifications(userId, lowered),
    ]);

    return {
      plans: planHits,
      scenarios: scenarioHits,
      executions: executionHits,
      notifications: notificationHits,
    };
  }

  private async searchPlans(userId: string, needle: string): Promise<SearchPlanHit[]> {
    const rows = await this.db.select({
      id: plans.id,
      status: plans.status,
      currentVersionId: plans.currentVersionId,
      activeVersionId: plans.activeVersionId,
    }).from(plans)
      .where(and(eq(plans.userId, userId), ne(plans.status, 'archived')))
      .orderBy(desc(plans.updatedAt))
      .limit(200);

    const versionIds = [...new Set(rows.flatMap((row) => [row.currentVersionId, row.activeVersionId]).filter((id): id is string => Boolean(id)))];
    const versionRows = versionIds.length
      ? await this.db.select({ id: planVersions.id, planId: planVersions.planId, name: planVersions.name, description: planVersions.description })
        .from(planVersions)
        .where(inArray(planVersions.id, versionIds))
      : [];
    const nameByPlan = new Map<string, string | null>();
    const descriptionByPlan = new Map<string, string | null>();
    const versionByPlan = new Map<string, typeof versionRows[number][]>();
    for (const version of versionRows) {
      const list = versionByPlan.get(version.planId) ?? [];
      list.push(version);
      versionByPlan.set(version.planId, list);
    }

    const hits: SearchPlanHit[] = [];
    for (const row of rows) {
      const versions = versionByPlan.get(row.id) ?? [];
      const current = versions.find((version) => version.id === row.currentVersionId) ?? versions[0];
      const name = current?.name ?? null;
      const description = current?.description ?? null;
      if (matches(name, needle) || matches(description, needle)) {
        hits.push({ id: row.id, name, description, status: row.status });
      }
    }
    return hits.slice(0, MAX_RESULTS);
  }

  private searchScenarios(needle: string): SearchScenarioHit[] {
    return SCENARIO_DEFINITIONS
      .filter((scenario) => matches(scenario.label, needle) || matches(scenario.key, needle))
      .slice(0, MAX_RESULTS)
      .map((scenario) => ({
        key: scenarioShortKey(scenario),
        domain: scenario.domain,
        label: scenario.label,
      }));
  }

  private async searchExecutions(userId: string, needle: string): Promise<SearchExecutionHit[]> {
    const pattern = likePattern(needle);
    const rows = await this.db.select({
      id: executions.id,
      planId: executions.planId,
      planName: planVersions.name,
      status: executions.status,
      resultSummary: executions.resultSummary,
      createdAt: executions.createdAt,
    }).from(executions)
      .innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
      .where(and(
        eq(executions.userId, userId),
        or(like(executions.resultSummary, pattern), like(executions.status, pattern)),
      ))
      .orderBy(desc(executions.createdAt))
      .limit(MAX_RESULTS);
    return rows;
  }

  private async searchNotifications(userId: string, needle: string): Promise<SearchNotificationHit[]> {
    const pattern = likePattern(needle);
    const rows = await this.db.select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      priority: notifications.priority,
      status: notifications.status,
      createdAt: notifications.createdAt,
    }).from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        ne(notifications.status, 'archived'),
        or(like(notifications.title, pattern), like(notifications.body, pattern)),
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(MAX_RESULTS);
    return rows;
  }
}

function scenarioShortKey(scenario: ScenarioDefinition): string {
  const prefix = `${scenario.domain}.`;
  return scenario.key.startsWith(prefix) ? scenario.key.slice(prefix.length) : scenario.key;
}

function matches(value: string | null | undefined, needle: string): boolean {
  return Boolean(value) && (value as string).toLocaleLowerCase('zh-CN').includes(needle);
}

/** Escape MySQL LIKE wildcards so user input is matched literally. */
function likePattern(needle: string): string {
  const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}
