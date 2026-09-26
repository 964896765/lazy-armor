import type {
  CreationDraft,
  CreationDraftInput,
  CreationDraftResumeAssessment,
} from '@lazy-armor/plan-schema';
import { api } from './api';

/** 首页「继续创建 N」与草稿列表读取入口。 */
export function listCreationDrafts(token: string): Promise<CreationDraft[]> {
  return api<CreationDraft[]>('/creation-drafts', token);
}

/** 向导进度自动保存：携带 version 做乐观并发，409 由调用方按服务端返回处理。 */
export function saveCreationDraft(token: string, input: CreationDraftInput): Promise<CreationDraft> {
  return api<CreationDraft>('/creation-drafts', token, { method: 'POST', body: JSON.stringify(input) });
}

/** 恢复评估：恢复前重新校验授权与方案有效期。 */
export function resumeCreationDraft(token: string, draftId: string): Promise<CreationDraftResumeAssessment> {
  return api<CreationDraftResumeAssessment>(`/creation-drafts/${encodeURIComponent(draftId)}/resume`, token, { method: 'POST' });
}
