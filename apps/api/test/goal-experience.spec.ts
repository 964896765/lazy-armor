import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GoalExperienceService, projectGoalExperience } from '../src/consumer/goal-experience.service';
import { GoalExperienceController } from '../src/consumer/goal-experience.controller';
import type { ConsumerService } from '../src/consumer/consumer.service';
vi.mock('../src/consumer/consumer.service', () => ({ ConsumerService: class ConsumerService {} }));
const conversationId = '01a12549-5915-7043-b5f3-ee6258827525';
const messageId = '01a12549-5915-7043-b5f3-ee6258827526';
const now = '2026-10-11T00:00:00.000Z';
const report = { version: 'agent-report.v1', revision: 1, stage: 'QUEUED', goal: '荆门洗车店评估', conversationVersion: 1, sources: [], warnings: [], updatedAt: now };
function conversation() { return { id: conversationId, title: '荆门洗车店评估', version: 1, mode: 'TEMPORARY', planId: null, updatedAt: now, messages: [{ id: messageId, requestId: 'r1', role: 'user', createdAt: now, structuredPayload: null }, { id: messageId, requestId: 'r1', role: 'assistant', createdAt: now, structuredPayload: { result: 'ANSWER', report } }] }; }
describe('Owner-scoped Goal Experience', () => {
  it('keeps queued reports incomplete with a direct result route and no invented progress', () => {
    const view = projectGoalExperience(conversation());
    expect(view.statusGroup).toBe('INCOMPLETE'); expect(view.status).toBe('报告等待生成');
    expect(view.primaryAction.path).toBe(`/report?conversationId=${conversationId}&messageId=${messageId}`);
    expect(view.report?.marketFactsVerified).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/percent|progress|40%|executionAuthorized":true/);
  });
  it('does not reuse an old completed report for a newer user request', () => {
    const value = conversation();
    value.messages[1]!.structuredPayload = { result: 'ANSWER', report: { ...report, stage: 'COMPLETED', markdown: '旧报告' } };
    value.messages.push({ id: conversationId, requestId: 'r2', role: 'user', createdAt: now, structuredPayload: null });
    const view = projectGoalExperience(value);
    expect(view.statusGroup).toBe('INCOMPLETE'); expect(view.report).toBeNull(); expect(view.primaryAction.path).toContain('/chat?');
  });
  it('uses the current durable job instead of an outdated inline placeholder', () => {
    const job = { schemaVersion: 'authoring-job.v1', jobId: conversationId, conversationId, requestId: 'r1', status: 'FAILED', stage: 'STOPPED', attemptCount: 2, maxAttempts: 2, createdAt: now, updatedAt: now, deadlineAt: now, resultMessageId: messageId, errorCode: 'MODEL_UNAVAILABLE', executionAuthorized: false };
    const value = conversation(); value.messages[1]!.structuredPayload = { result: 'AUTHORING_PENDING', authoringJob: { ...job, status: 'QUEUED', stage: 'QUEUED' } } as never;
    const view = projectGoalExperience({ ...value, authoringJobs: [job] });
    expect(view.status).toBe('本次方案未生成'); expect(view.authoringJob?.status).toBe('FAILED'); expect(view.statusGroup).toBe('INCOMPLETE');
  });
  it('preserves ownership checks and unavailable detail reads instead of false empty success', async () => {
    const owned = conversation();
    const read = vi.fn(async (owner: string) => { if (owner !== 'owner') throw new NotFoundException(); return owned; });
    const list = vi.fn(async () => [{ id: conversationId }, { id: messageId }]);
    const consumer = { conversations: list, conversation: vi.fn(async (owner: string, id: string) => { if (id === messageId) throw new NotFoundException(); return read(owner); }) } as unknown as ConsumerService;
    const service = new GoalExperienceService(consumer);
    await expect(service.get('other', conversationId)).rejects.toBeInstanceOf(NotFoundException);
    const projected = await service.list('owner', 2);
    expect(list).toHaveBeenCalledWith('owner'); expect(projected.items).toHaveLength(1); expect(projected.unavailableConversationIds).toEqual([messageId]);
    const limited = await service.list('owner', 1); expect(limited.truncated).toBe(true);
    expect(consumer.conversation).toHaveBeenCalledWith('owner', conversationId);
  });
  it('bounds page requests before owner-scoped reads', () => {
    const list = vi.fn(); const controller = new GoalExperienceController({ list } as unknown as GoalExperienceService);
    expect(() => controller.list({ id: 'owner' } as never, 0)).toThrow(); expect(() => controller.list({ id: 'owner' } as never, 21)).toThrow(); expect(list).not.toHaveBeenCalled();
  });
  it('does not ask for a second review after the original Plan confirmation', () => {
    const value = conversation(); value.messages[1]!.structuredPayload = { result: 'PLAN_DRAFT' } as never;
    const view = projectGoalExperience({ ...value, status: 'PLAN_CONFIRMED', planId: conversationId });
    expect(view.status).toBe('计划已创建'); expect(view.statusGroup).toBe('INCOMPLETE'); expect(view.primaryAction.path).toBe(`/plans/${conversationId}`);
    expect(view.nextStep).not.toContain('审阅');
  });
});
