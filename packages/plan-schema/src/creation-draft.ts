import { z } from 'zod';
import {
  scenarioGoalSpecSchema,
  scenarioResourceSubjectSchema,
  type ScenarioGoalSpec,
  type ScenarioResourceSubject,
} from './scenario-contract-v2';
import type { SourceSelection } from './source-selection';

/**
 * 创建流程草稿（CreationDraft）合同。
 *
 * 与正式计划严格分离：
 *  - CreationDraft 是五阶段创建向导进行中的 UI 草稿，尚未生成 Plan ID，
 *    只保存用户已填写且允许保存的进度，用于首页「继续创建 N」恢复。
 *  - 已有正式 Plan ID 的 Draft Plan（服务端 Plan 处于 draft 状态）属于计划中心，
 *    不是本实体。
 *  - 不可变 PlanVersion 由 Offer choose 生成，草稿不直接产生版本。
 *
 * 草稿只保存向导输入；来源选择（sourceChoices）和选中 Offer 由服务端按
 * FactDemand / SourceResolver / PlanOffer 校验后落库，客户端不得伪造已授权、
 * 已在线或已过期的来源。
 */
export const CREATION_DRAFT_CONTRACT_VERSION = 1 as const;

export const CREATION_DRAFT_STAGES = [1, 2, 3, 4, 5] as const;
export type CreationDraftStage = (typeof CREATION_DRAFT_STAGES)[number];

export const CREATION_DRAFT_STATES = ['ACTIVE', 'COMPLETED', 'DISCARDED', 'EXPIRED'] as const;
export type CreationDraftState = (typeof CREATION_DRAFT_STATES)[number];

/** 客户端在阶段 3 提交的来源选择：只允许引用已解析候选的 sourceId。 */
export const creationDraftSourceChoiceSchema = z.object({
  demandId: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(255),
}).strict();
export type CreationDraftSourceChoiceInput = z.infer<typeof creationDraftSourceChoiceSchema>;

/** 自动保存 / 恢复的输入（客户端可编辑的向导进度）。 */
export const creationDraftInputSchema = z.object({
  scenarioKey: z.string().trim().min(1).max(120),
  scenarioRevision: z.number().int().positive(),
  stage: z.number().int().min(1).max(5),
  goal: scenarioGoalSpecSchema,
  subject: scenarioResourceSubjectSchema.nullable(),
  sourceChoices: z.array(creationDraftSourceChoiceSchema).max(50).optional(),
  selectedOfferKey: z.string().trim().min(1).max(160).nullable().optional(),
  version: z.number().int().nonnegative().optional(),
}).strict();
export type CreationDraftInput = z.infer<typeof creationDraftInputSchema>;

/** 服务端校验后的来源选择（持久化）。 */
export interface CreationDraftSourceChoice {
  demandId: string;
  factKey: string;
  subjectKey: string;
  selection: SourceSelection;
}

/** 持久化的创建流程草稿实体。 */
export interface CreationDraft {
  contractVersion: typeof CREATION_DRAFT_CONTRACT_VERSION;
  draftId: string;
  scenarioKey: string;
  scenarioRevision: number;
  stage: CreationDraftStage;
  goal: ScenarioGoalSpec;
  subject: ScenarioResourceSubject | null;
  sourceChoices: readonly CreationDraftSourceChoice[];
  selectedOfferKey: string | null;
  version: number;
  state: CreationDraftState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/**
 * 恢复评估状态：继续创建前必须重新检查 Offer TTL、来源授权、新鲜度和治理状态，
 * 过期方案要求重新生成，而不是沿用旧审批。
 */
export const CREATION_DRAFT_RESUME_STATES = [
  'READY',
  'NEEDS_SUBJECT',
  'NEEDS_SOURCE_REVIEW',
  'NEEDS_OFFER_REGENERATION',
  'NEEDS_RECONFIRMATION',
] as const;
export type CreationDraftResumeState = (typeof CREATION_DRAFT_RESUME_STATES)[number];

export interface CreationDraftResumeAssessment {
  contractVersion: 1;
  draftId: string;
  state: CreationDraftResumeState;
  reasonCodes: readonly string[];
  scenario: Readonly<{ key: string; revision: number; contractHash: string }>;
  goal: ScenarioGoalSpec;
  subject: ScenarioResourceSubject | null;
  currentStage: CreationDraftStage;
  selectedOfferKey: string | null;
  evaluatedAt: string;
}
