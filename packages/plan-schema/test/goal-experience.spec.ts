import { describe, expect, it } from 'vitest';
import { conversationGenerationOutcome, goalExperienceSchema } from '../src/goal-experience';
const conversationId = '01a12549-5915-7043-b5f3-ee6258827525';
const report = { version: 'agent-report.v1', revision: 0, stage: 'QUEUED', goal: '开洗车店', conversationVersion: 1, sources: [], warnings: [], updatedAt: '2026-10-11T00:00:00.000Z' };
const job = { schemaVersion: 'authoring-job.v1', jobId: conversationId, conversationId, requestId: 'request', status: 'SUCCEEDED', stage: 'COMPLETED', attemptCount: 1, maxAttempts: 2, createdAt: report.updatedAt, updatedAt: report.updatedAt, deadlineAt: '2026-10-11T00:10:00.000Z', resultMessageId: conversationId, errorCode: null, executionAuthorized: false };
describe('Goal experience generation boundaries', () => {
  it.each(['QUEUED', 'PLANNING', 'RESEARCHING', 'WRITING', 'REVIEWING', 'FAILED', 'SUPERSEDED'])('never completes an ANSWER while report is %s', stage => {
    expect(conversationGenerationOutcome('ANSWER', { ...report, stage }, job)).toMatchObject({ statusGroup: 'INCOMPLETE', phase: 'REPORT', stage });
  });
  it('requires actual report body and distinguishes generated delivery from verified market facts', () => {
    expect(conversationGenerationOutcome('ANSWER', { ...report, stage: 'COMPLETED' }).statusGroup).toBe('INCOMPLETE');
    expect(conversationGenerationOutcome('ANSWER', { ...report, stage: 'COMPLETED', markdown: '# 评估\n参数仍是假设' })).toMatchObject({ status: '报告已生成', statusGroup: 'COMPLETED', code: 'REPORT_COMPLETED' });
    expect(goalExperienceSchema.shape.report.unwrap().shape.marketFactsVerified.safeParse(true).success).toBe(false);
  });
  it.each(['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'SUPERSEDED'])('never promotes stale ANSWER during authoring %s', status => {
    expect(conversationGenerationOutcome('ANSWER', undefined, { ...job, status, stage: status === 'RUNNING' ? 'COMPILING' : 'STOPPED' }).statusGroup).toBe('INCOMPLETE');
  });
  it('a successful authoring job preserves independent proposal confirmation and pending delivery', () => {
    expect(conversationGenerationOutcome('PLAN_DRAFT', undefined, job)).toMatchObject({ status: '草案待确认', statusGroup: 'INCOMPLETE' });
    expect(conversationGenerationOutcome('AUTHORING_PENDING', undefined, job).statusGroup).toBe('INCOMPLETE');
    expect(conversationGenerationOutcome('ANSWER', undefined, job).statusGroup).toBe('COMPLETED');
  });
  it('rejects malformed/authority-bearing generation data without guessing success', () => {
    expect(conversationGenerationOutcome('ANSWER', { stage: 'COMPLETED' }).statusGroup).toBe('INCOMPLETE');
    expect(conversationGenerationOutcome('ANSWER', undefined, { ...job, executionAuthorized: true })).toMatchObject({ statusGroup: 'INCOMPLETE', code: 'AUTHORING_UNKNOWN' });
  });
});
