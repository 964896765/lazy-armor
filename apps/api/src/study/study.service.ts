import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { plans, studyProgressProfiles, studyTasks } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type StudyContext = Record<string, unknown>;

interface StudyPlanConfig {
  examName: string;
  examDate: string;
  subjects: string[];
  dailyStudyMinutes: number;
  preferredStudyTime: string;
  target: string;
  currentProgressPercent: number;
  weeklySummaryDay: string;
  missedTaskStrategy: 'catch_up_today' | 'rebalance_future';
}

interface StudyProgressShape {
  id?: string;
  currentProgressPercent: number;
  completedTaskCount: number;
  missedTaskCount: number;
  lastStudiedAt: string | null;
  lastGeneratedForDate: string | null;
  sourceType: string;
}

@Injectable()
export class StudyService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async getProgress(userId: string, planId: string) {
    await this.assertPlanOwned(userId, planId);
    const profile = await this.getStoredProgressProfile(userId, planId);
    return profile ?? {
      sourcePlanId: planId,
      currentProgressPercent: 0,
      completedTaskCount: 0,
      missedTaskCount: 0,
      lastStudiedAt: null,
      lastGeneratedForDate: null,
      sourceType: 'manual',
    };
  }

  async listTasks(userId: string, planId: string, studyDate?: string) {
    await this.assertPlanOwned(userId, planId);
    return this.listTasksInternal(userId, planId, studyDate ? this.startOfDay(new Date(studyDate)) : null);
  }

  async updateProgress(userId: string, input: {
    planId: string;
    currentProgressPercent?: number;
    completedTaskIds?: string[];
  }) {
    await this.assertPlanOwned(userId, input.planId);
    const existing = await this.getStoredProgressProfile(userId, input.planId);
    const now = new Date();
    const completedTaskIds = (input.completedTaskIds ?? []).filter((item) => typeof item === 'string');

    if (completedTaskIds.length > 0) {
      const ownedTasks = await this.db.select({ id: studyTasks.id }).from(studyTasks)
        .where(and(
          eq(studyTasks.userId, userId),
          eq(studyTasks.sourcePlanId, input.planId),
          inArray(studyTasks.id, completedTaskIds),
        ));
      for (const task of ownedTasks) {
        await this.db.update(studyTasks).set({
          status: 'completed',
          completedAt: now,
          updatedAt: now,
        }).where(eq(studyTasks.id, task.id));
      }
    }

    const counters = await this.computeTaskCounters(userId, input.planId);
    const nextProgress = typeof input.currentProgressPercent === 'number'
      ? input.currentProgressPercent
      : existing?.currentProgressPercent ?? 0;

    await this.db.insert(studyProgressProfiles).values({
      id: newId(),
      userId,
      sourcePlanId: input.planId,
      currentProgressPercent: nextProgress,
      completedTaskCount: counters.completed,
      missedTaskCount: counters.missed,
      lastStudiedAt: completedTaskIds.length > 0 ? now : existing?.lastStudiedAt ? new Date(existing.lastStudiedAt) : null,
      lastGeneratedForDate: existing?.lastGeneratedForDate ? new Date(existing.lastGeneratedForDate) : null,
      sourceType: existing?.sourceType ?? 'manual',
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        currentProgressPercent: nextProgress,
        completedTaskCount: counters.completed,
        missedTaskCount: counters.missed,
        lastStudiedAt: completedTaskIds.length > 0 ? now : existing?.lastStudiedAt ? new Date(existing.lastStudiedAt) : null,
        updatedAt: now,
      },
    });

    return this.getProgress(userId, input.planId);
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: StudyContext) {
    const planConfig = this.normalizePlanConfig(config);
    if (!planConfig) return context;
    const planId = typeof context.planId === 'string' ? context.planId : null;
    const reference = this.referenceDate(context.referenceDate);
    const progress = planId ? await this.getStoredProgressProfile(userId, planId) : null;
    const tasks = planId ? await this.listTasksInternal(userId, planId, this.startOfDay(reference)) : [];
    return this.enrichContext({
      ...context,
      studyPlanConfig: planConfig,
      studyProgressProfile: progress ?? {
        currentProgressPercent: planConfig.currentProgressPercent,
        completedTaskCount: 0,
        missedTaskCount: 0,
        lastStudiedAt: null,
        lastGeneratedForDate: null,
        sourceType: 'internal',
      },
      studyTasks: tasks,
    });
  }

  enrichContext(context: StudyContext) {
    const planConfig = this.normalizePlanConfig(context.studyPlanConfig ?? context);
    if (!planConfig) return context;
    const progress = this.normalizeProgress(context.studyProgressProfile) ?? {
      currentProgressPercent: planConfig.currentProgressPercent,
      completedTaskCount: 0,
      missedTaskCount: 0,
      lastStudiedAt: null,
      lastGeneratedForDate: null,
      sourceType: 'internal',
    };
    const currentProgressPercent = typeof context.currentProgressPercent === 'number'
      ? context.currentProgressPercent
      : progress.currentProgressPercent;
    const completedTaskCount = typeof context.completedTaskCount === 'number'
      ? context.completedTaskCount
      : progress.completedTaskCount;
    const missedTaskCount = typeof context.missedTaskCount === 'number'
      ? context.missedTaskCount
      : progress.missedTaskCount;
    const tasks = this.normalizeTasks(context.studyTasks);
    const reference = this.referenceDate(context.referenceDate);
    const studyDate = this.startOfDay(reference);
    const daysUntilExam = this.daysBetween(studyDate, this.startOfDay(new Date(planConfig.examDate)));
    const weeklySummaryDay = this.weekdayName(studyDate);
    const weeklySummaryDue = weeklySummaryDay === planConfig.weeklySummaryDay;
    return {
      ...context,
      studyPlanConfig: planConfig,
      studyProgressProfile: progress,
      studyTasks: tasks,
      examName: planConfig.examName,
      examDate: planConfig.examDate,
      studySubjects: planConfig.subjects,
      dailyStudyMinutes: planConfig.dailyStudyMinutes,
      preferredStudyTime: planConfig.preferredStudyTime,
      studyTarget: planConfig.target,
      currentProgressPercent,
      completedTaskCount,
      missedTaskCount,
      daysUntilExam,
      weeklySummaryDue,
      pendingStudyTaskCount: tasks.filter((task) => task.status === 'pending').length,
      completedStudyTaskCount: tasks.filter((task) => task.status === 'completed').length,
      missedTaskStrategy: planConfig.missedTaskStrategy,
      studyReferenceDate: studyDate.toISOString(),
    };
  }

  async generateDailyTasks(userId: string, planId: string, context: StudyContext) {
    await this.assertPlanOwned(userId, planId);
    const enriched = this.enrichContext(context);
    const planConfig = this.normalizePlanConfig(enriched.studyPlanConfig ?? enriched);
    if (!planConfig) throw new Error('Study plan config is missing');

    const now = new Date();
    const reference = this.referenceDate(enriched.referenceDate);
    const studyDate = this.startOfDay(reference);
    const examDate = this.startOfDay(new Date(planConfig.examDate));
    const daysUntilExam = this.daysBetween(studyDate, examDate);
    const progress = await this.ensureProgressProfile(userId, planId, planConfig, now);
    const newlyMissed = await this.markMissedTasks(userId, planId, studyDate, now);
    let todayTasks = await this.listTasksInternal(userId, planId, studyDate);

    if (daysUntilExam >= 0 && todayTasks.length === 0) {
      const taskSpecs = this.buildStudyTasks(planConfig, studyDate, progress.currentProgressPercent, newlyMissed);
      for (const [index, task] of taskSpecs.entries()) {
        const dedupeKey = `study:${planId}:${studyDate.toISOString().slice(0, 10)}:${index}:${task.subject}`;
        await this.db.insert(studyTasks).values({
          id: newId(),
          userId,
          sourcePlanId: planId,
          studyDate,
          subject: task.subject,
          title: task.title,
          durationMinutes: task.durationMinutes,
          status: 'pending',
          isCatchUp: task.isCatchUp ? 1 : 0,
          dedupeKey,
          completedAt: null,
          metadataJson: {
            examName: planConfig.examName,
            target: planConfig.target,
            scheduledTime: planConfig.preferredStudyTime,
          },
          createdAt: now,
          updatedAt: now,
        }).onDuplicateKeyUpdate({
          set: {
            title: task.title,
            durationMinutes: task.durationMinutes,
            isCatchUp: task.isCatchUp ? 1 : 0,
            metadataJson: {
              examName: planConfig.examName,
              target: planConfig.target,
              scheduledTime: planConfig.preferredStudyTime,
            },
            updatedAt: now,
          },
        });
      }
      todayTasks = await this.listTasksInternal(userId, planId, studyDate);
    }

    const counters = await this.computeTaskCounters(userId, planId);
    const weeklySummary = await this.buildWeeklySummary(userId, planId, studyDate, planConfig);
    await this.db.insert(studyProgressProfiles).values({
      id: newId(),
      userId,
      sourcePlanId: planId,
      currentProgressPercent: progress.currentProgressPercent,
      completedTaskCount: counters.completed,
      missedTaskCount: counters.missed,
      lastStudiedAt: progress.lastStudiedAt ? new Date(progress.lastStudiedAt) : null,
      lastGeneratedForDate: studyDate,
      sourceType: progress.sourceType,
      metadataJson: {
        examName: planConfig.examName,
        target: planConfig.target,
      },
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        completedTaskCount: counters.completed,
        missedTaskCount: counters.missed,
        lastGeneratedForDate: studyDate,
        updatedAt: now,
      },
    });

    return {
      studyTasks: todayTasks,
      generatedTaskCount: todayTasks.length,
      totalStudyMinutes: todayTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
      missedTaskCount: counters.missed,
      currentProgressPercent: progress.currentProgressPercent,
      adjustedFuturePlan: newlyMissed.length > 0,
      weeklySummary,
      weeklySummaryDue: weeklySummary.isSummaryDay,
      daysUntilExam,
      examName: planConfig.examName,
      humanSummary: todayTasks.length > 0
        ? `今天已安排 ${todayTasks.length} 项学习任务，共 ${todayTasks.reduce((sum, task) => sum + task.durationMinutes, 0)} 分钟。`
        : daysUntilExam < 0
          ? `${planConfig.examName} 的考试日期已到，今天不再生成新的学习任务。`
          : '今天暂时没有新的学习任务。',
      resultSummary: todayTasks.length > 0
        ? `今天已安排 ${todayTasks.length} 项学习任务，共 ${todayTasks.reduce((sum, task) => sum + task.durationMinutes, 0)} 分钟。`
        : daysUntilExam < 0
          ? `${planConfig.examName} 的考试日期已到，今天不再生成新的学习任务。`
          : '今天暂时没有新的学习任务。',
    };
  }

  private async assertPlanOwned(userId: string, planId: string) {
    const row = (await this.db.select({ id: plans.id }).from(plans)
      .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
      .limit(1))[0];
    if (!row) throw new NotFoundException('Plan not found');
  }

  private async getStoredProgressProfile(userId: string, planId: string) {
    const row = (await this.db.select().from(studyProgressProfiles)
      .where(and(eq(studyProgressProfiles.userId, userId), eq(studyProgressProfiles.sourcePlanId, planId)))
      .limit(1))[0];
    return row ? {
      id: row.id,
      sourcePlanId: row.sourcePlanId,
      currentProgressPercent: row.currentProgressPercent,
      completedTaskCount: row.completedTaskCount,
      missedTaskCount: row.missedTaskCount,
      lastStudiedAt: row.lastStudiedAt?.toISOString() ?? null,
      lastGeneratedForDate: row.lastGeneratedForDate?.toISOString() ?? null,
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } : null;
  }

  private async ensureProgressProfile(userId: string, planId: string, config: StudyPlanConfig, now: Date) {
    const existing = await this.getStoredProgressProfile(userId, planId);
    if (existing) return existing;
    await this.db.insert(studyProgressProfiles).values({
      id: newId(),
      userId,
      sourcePlanId: planId,
      currentProgressPercent: config.currentProgressPercent,
      completedTaskCount: 0,
      missedTaskCount: 0,
      lastStudiedAt: null,
      lastGeneratedForDate: null,
      sourceType: 'internal',
      metadataJson: {
        examName: config.examName,
        target: config.target,
      },
      createdAt: now,
      updatedAt: now,
    });
    return (await this.getStoredProgressProfile(userId, planId))!;
  }

  private async markMissedTasks(userId: string, planId: string, studyDate: Date, now: Date) {
    const rows = await this.db.select().from(studyTasks)
      .where(and(
        eq(studyTasks.userId, userId),
        eq(studyTasks.sourcePlanId, planId),
        eq(studyTasks.status, 'pending'),
        lt(studyTasks.studyDate, studyDate),
      ))
      .orderBy(asc(studyTasks.studyDate));
    for (const row of rows) {
      await this.db.update(studyTasks).set({
        status: 'missed',
        updatedAt: now,
      }).where(eq(studyTasks.id, row.id));
    }
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      durationMinutes: row.durationMinutes,
      studyDate: row.studyDate.toISOString(),
      status: 'missed' as const,
      title: row.title,
      isCatchUp: true,
    }));
  }

  private async computeTaskCounters(userId: string, planId: string) {
    const rows = await this.db.select({
      status: studyTasks.status,
    }).from(studyTasks)
      .where(and(eq(studyTasks.userId, userId), eq(studyTasks.sourcePlanId, planId)));
    return rows.reduce((accumulator, row) => {
      if (row.status === 'completed') accumulator.completed += 1;
      if (row.status === 'missed') accumulator.missed += 1;
      return accumulator;
    }, { completed: 0, missed: 0 });
  }

  private async listTasksInternal(userId: string, planId: string, studyDate: Date | null) {
    const filters = [eq(studyTasks.userId, userId), eq(studyTasks.sourcePlanId, planId)];
    if (studyDate) filters.push(eq(studyTasks.studyDate, studyDate));
    const rows = await this.db.select().from(studyTasks)
      .where(and(...filters))
      .orderBy(asc(studyTasks.studyDate), asc(studyTasks.createdAt));
    return rows.map((row) => ({
      id: row.id,
      sourcePlanId: row.sourcePlanId,
      studyDate: row.studyDate.toISOString(),
      subject: row.subject,
      title: row.title,
      durationMinutes: row.durationMinutes,
      status: row.status,
      isCatchUp: Boolean(row.isCatchUp),
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async buildWeeklySummary(userId: string, planId: string, studyDate: Date, planConfig: StudyPlanConfig) {
    const windowStart = new Date(studyDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - 6);
    const rows = await this.db.select().from(studyTasks)
      .where(and(
        eq(studyTasks.userId, userId),
        eq(studyTasks.sourcePlanId, planId),
        eq(studyTasks.status, 'completed'),
      ))
      .orderBy(desc(studyTasks.studyDate));
    const recent = rows.filter((row) => row.studyDate >= windowStart && row.studyDate <= studyDate);
    const totalMinutes = recent.reduce((sum, row) => sum + row.durationMinutes, 0);
    return {
      isSummaryDay: this.weekdayName(studyDate) === planConfig.weeklySummaryDay,
      completedTaskCount: recent.length,
      completedMinutes: totalMinutes,
      target: planConfig.target,
    };
  }

  private normalizePlanConfig(value: unknown): StudyPlanConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const subjectList = Array.isArray(row.subjects)
      ? row.subjects.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : typeof row.subjects === 'string'
        ? row.subjects.split(/[,\n，]/).map((item) => item.trim()).filter(Boolean)
        : [];
    const currentProgressPercent = typeof row.currentProgressPercent === 'number'
      ? row.currentProgressPercent
      : typeof row.currentProgress === 'number'
        ? row.currentProgress
        : 0;
    if (
      typeof row.examName !== 'string'
      || typeof row.examDate !== 'string'
      || subjectList.length === 0
      || typeof row.dailyStudyMinutes !== 'number'
      || typeof row.preferredStudyTime !== 'string'
      || typeof row.target !== 'string'
    ) return null;
    return {
      examName: row.examName,
      examDate: row.examDate,
      subjects: subjectList,
      dailyStudyMinutes: row.dailyStudyMinutes,
      preferredStudyTime: row.preferredStudyTime,
      target: row.target,
      currentProgressPercent,
      weeklySummaryDay: typeof row.weeklySummaryDay === 'string' ? row.weeklySummaryDay : 'sunday',
      missedTaskStrategy: row.missedTaskStrategy === 'rebalance_future' ? 'rebalance_future' : 'catch_up_today',
    };
  }

  private normalizeProgress(value: unknown): StudyProgressShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.currentProgressPercent !== 'number'
      || typeof row.completedTaskCount !== 'number'
      || typeof row.missedTaskCount !== 'number'
    ) return null;
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      currentProgressPercent: row.currentProgressPercent,
      completedTaskCount: row.completedTaskCount,
      missedTaskCount: row.missedTaskCount,
      lastStudiedAt: typeof row.lastStudiedAt === 'string' ? row.lastStudiedAt : null,
      lastGeneratedForDate: typeof row.lastGeneratedForDate === 'string' ? row.lastGeneratedForDate : null,
      sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'internal',
    };
  }

  private normalizeTasks(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== 'string'
        || typeof row.studyDate !== 'string'
        || typeof row.subject !== 'string'
        || typeof row.title !== 'string'
        || typeof row.durationMinutes !== 'number'
        || typeof row.status !== 'string'
      ) return [];
      return [{
        id: row.id,
        studyDate: row.studyDate,
        subject: row.subject,
        title: row.title,
        durationMinutes: row.durationMinutes,
        status: row.status,
        isCatchUp: Boolean(row.isCatchUp),
      }];
    });
  }

  private buildStudyTasks(
    planConfig: StudyPlanConfig,
    studyDate: Date,
    currentProgressPercent: number,
    newlyMissed: Array<{ subject: string }>,
  ) {
    const subjectPool = this.prioritizeSubjects(planConfig, studyDate, currentProgressPercent, newlyMissed);
    const taskCount = Math.max(1, Math.min(subjectPool.length, planConfig.dailyStudyMinutes >= 120 ? 3 : planConfig.dailyStudyMinutes >= 60 ? 2 : 1));
    const durations = this.splitDurations(planConfig.dailyStudyMinutes, taskCount);
    return subjectPool.slice(0, taskCount).map((subject, index) => {
      const isCatchUp = newlyMissed.some((item) => item.subject === subject) && planConfig.missedTaskStrategy === 'catch_up_today';
      return {
        subject,
        title: isCatchUp ? `${subject}补漏复习` : `${subject}今日学习`,
        durationMinutes: durations[index] ?? durations[durations.length - 1] ?? planConfig.dailyStudyMinutes,
        isCatchUp,
      };
    });
  }

  private prioritizeSubjects(
    planConfig: StudyPlanConfig,
    studyDate: Date,
    currentProgressPercent: number,
    newlyMissed: Array<{ subject: string }>,
  ) {
    const subjects = [...planConfig.subjects];
    const catchUpSubjects = Array.from(new Set(newlyMissed.map((item) => item.subject))).filter((subject) => subjects.includes(subject));
    const rotationSeed = studyDate.getUTCFullYear() + (studyDate.getUTCMonth() * 31) + studyDate.getUTCDate() + Math.floor(currentProgressPercent / 20);
    const rotationStart = subjects.length === 0 ? 0 : rotationSeed % subjects.length;
    const rotated = [...subjects.slice(rotationStart), ...subjects.slice(0, rotationStart)];
    if (planConfig.missedTaskStrategy === 'catch_up_today' && catchUpSubjects.length > 0) {
      return [...catchUpSubjects, ...rotated.filter((subject) => !catchUpSubjects.includes(subject))];
    }
    if (planConfig.missedTaskStrategy === 'rebalance_future' && catchUpSubjects.length > 0) {
      return [...rotated.filter((subject) => !catchUpSubjects.includes(subject)), ...catchUpSubjects];
    }
    return rotated;
  }

  private splitDurations(totalMinutes: number, taskCount: number) {
    if (taskCount <= 1) return [totalMinutes];
    const base = Math.floor(totalMinutes / taskCount);
    const remainder = totalMinutes % taskCount;
    return Array.from({ length: taskCount }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  private referenceDate(value: unknown) {
    const date = typeof value === 'string' ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private startOfDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private daysBetween(from: Date, to: Date) {
    return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }

  private weekdayName(date: Date) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    return names[date.getUTCDay()] ?? 'sunday';
  }
}
