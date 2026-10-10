import { describe, expect, it } from 'vitest';
import type { AgentTaskProjection, TaskGraphProjection } from '@lazy-armor/plan-schema/mobile';
import { taskDetail, taskGraphDetail, taskStatusLabel } from './task-presenter';
describe('Task progress stays truthful', () => {
  const base: AgentTaskProjection = { id: 'step', parentTaskId: 'root', executionStepId: 'runtime-step', title: '执行', status: 'WAITING', recordedStatus: 'CREATED', runtimeStatus: 'pending', priority: 5, dependsOn: [], retryCount: 0, skipped: false, waitReason: 'DEPENDENCY' };
  it('does not present skipped work or unknown effects as completed', () => {
    expect(taskDetail({ ...base, status: 'SUCCESS', skipped: true })).toBe('本次未执行');
    expect(taskDetail({ ...base, status: 'UNKNOWN', waitReason: null })).toBe('正在核对实际结果');
    expect(taskStatusLabel('UNKNOWN')).toBe('结果待核对');
  });
  it('separates confirmation, dependency waiting and safe retry', () => {
    expect(taskDetail(base)).toBe('等待前一项完成');
    expect(taskDetail({ ...base, waitReason: 'APPROVAL' })).toBe('等待你的审批');
    expect(taskDetail({ ...base, waitReason: 'RETRY' })).toBe('等待受控重试');
  });
  it('does not leave unstarted steps waiting after their execution ends', () => {
    expect(taskDetail({...base,status:'CANCELLED',waitReason:null})).toBe('已取消，本次未开始');
    expect(taskDetail({...base,status:'FAILED',waitReason:null})).toBe('本次未开始，运行已停止');
  });
  it('counts only actually completed steps and marks old versions', () => {
    const graph = { status: 'SUCCESS', historical: true, tasks: [{ ...base, status: 'SUCCESS', skipped: true }, { ...base, status: 'SUCCESS', skipped: false }] } as TaskGraphProjection;
    expect(taskGraphDetail(graph)).toBe('已完成 · 1/2 项完成 · 较早版本');
  });
});
