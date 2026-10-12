import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { consumerConversations, consumerMessages } from '@lazy-armor/database';
import { catalogHash, compileSkillResourceGraph, compositionOptionsSchema, goalBriefSchema, skillMethodPorts, skillMethodRefsSchema, skillResourceGraphRequestSchema, suggestSkillResourceGraph } from '@lazy-armor/plan-schema';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SkillRepositoriesService } from '../portable-skills/skill-repositories.service';
import { GoalResourceMatchService } from './goal-resource-match.service';

/** Owner-scoped structure preview, not a Plan compiler or a new Runtime. */
@Injectable()
export class CompositionPreviewService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly methods: SkillRepositoriesService, private readonly resources: GoalResourceMatchService) {}
  async options(userId: string, id: string) {
    const conversation = (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.archivedAt || conversation.status === 'PROCESSING') throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    const refs = skillMethodRefsSchema.parse((conversation.contextRefs ?? []).flatMap(ref => ref.type === 'SkillMethod' ? [ref.methodRef] : []));
    const choices = await this.methods.selectedContext(userId, refs);
    if (!choices.length) throw new BadRequestException('COMPOSITION_METHODS_REQUIRED');
    const message = (await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt), desc(consumerMessages.id)).limit(1))[0];
    const parsedGoal = goalBriefSchema.safeParse(message?.structuredPayload?.goalBrief);
    if (message?.structuredPayload?.goalBrief && !parsedGoal.success) throw new ConflictException('GOAL_BRIEF_VERSION_UNSUPPORTED');
    const goal = parsedGoal.success ? parsedGoal.data : null;
    return compositionOptionsSchema.parse({ conversationId: id, conversationVersion: conversation.version, executionAuthorized: false,
      methods: choices.map(choice => ({ ref: choice.ref, name: choice.manifest.name, input: skillMethodPorts(choice.manifest.input), output: skillMethodPorts(choice.manifest.output) })),
      goal, suggested: suggestSkillResourceGraph(conversation.version, choices, goal) });
  }
  async preview(userId: string, id: string, raw: unknown) {
    const parsed = skillResourceGraphRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('COMPOSITION_INPUT_INVALID');
    const request = parsed.data;
    const conversation = (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.version !== request.version || conversation.archivedAt || conversation.status === 'PROCESSING') throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
    const refs = skillMethodRefsSchema.parse((conversation.contextRefs ?? []).flatMap(ref => ref.type === 'SkillMethod' ? [ref.methodRef] : []));
    const choices = await this.methods.selectedContext(userId, refs);
    if (!choices.length) throw new BadRequestException('COMPOSITION_METHODS_REQUIRED');
    const message = (await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant')))
      .orderBy(desc(consumerMessages.createdAt), desc(consumerMessages.id)).limit(1))[0];
    const goal = goalBriefSchema.safeParse(message?.structuredPayload?.goalBrief);
    if (message?.structuredPayload?.goalBrief && !goal.success) throw new ConflictException('GOAL_BRIEF_VERSION_UNSUPPORTED');
    const userSources = goal.success ? request.goalBindings.flatMap(binding => goal.data.fields.find(field => field.key === binding.goalField)?.sourceRefs.filter(ref => ref.kind === 'USER_MESSAGE') ?? []) : [];
    if (userSources.some(source => !z.uuid().safeParse(source.id).success)) throw new ConflictException('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
    const sourceIds = [...new Set(userSources.map(source => source.id))];
    const sourceMessages = sourceIds.length ? await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'user'), inArray(consumerMessages.id, sourceIds))) : [];
    if (userSources.some(ref => !sourceMessages.some(row => row.id === ref.id && row.content.includes(ref.quote)))) throw new ConflictException('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
    const matched = await this.resources.forMethods(userId, id, request.version);
    const graph = compileSkillResourceGraph(request, choices, goal.success ? goal.data : null, matched);
    await this.db.transaction(async tx => {
      const current = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId))).for('update'))[0];
      if (!current || current.deletedAt || current.archivedAt || current.status === 'PROCESSING' || current.version !== request.version || catalogHash(current.contextRefs) !== catalogHash(conversation.contextRefs)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
      if (!await this.methods.refsCurrent(tx, userId, refs)) throw new ConflictException('SKILL_CONTEXT_CHANGED');
      if (message) {
        const source = (await tx.select().from(consumerMessages).where(eq(consumerMessages.id, message.id)).for('update'))[0];
        if (!source || catalogHash(source.structuredPayload) !== catalogHash(message.structuredPayload)) throw new ConflictException('COMPOSITION_CONTEXT_CHANGED');
      }
      for (const prior of sourceMessages) {
        const currentSource = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, prior.id), eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'user'))).for('update'))[0];
        if (!currentSource || catalogHash(currentSource.content) !== catalogHash(prior.content)) throw new ConflictException('COMPOSITION_GOAL_SOURCE_UNAVAILABLE');
      }
    });
    const goalBriefRef = goal.success ? { goalId: goal.data.goalId, version: goal.data.version, contentHash: catalogHash(goal.data) } : null;
    const sourceMessageRefs = sourceMessages.map(source => ({ id: source.id, contentHash: catalogHash(source.content) })).sort((a, b) => a.id.localeCompare(b.id));
    return { ...graph, conversationId: id, conversationVersion: request.version, goalBriefRef, sourceMessageRefs, previewHash: catalogHash({ request, graph, goalBriefRef, sourceMessageRefs }),
      evaluatedAt: new Date().toISOString(), limitation: '结构与资源观察结果仅供规划；尚未编译原 Runtime Recipe、费用范围或实际绑定，不能执行。' };
  }
}
