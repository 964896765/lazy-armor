import { z } from 'zod';
import { agentReportSchema, conversationGenerationOutcome, goalBriefSchema } from '@lazy-armor/plan-schema/mobile';

const conversationSchema = z.object({ id: z.uuid(), version: z.number().int().nonnegative(), mode: z.enum(['TEMPORARY', 'PLAN']),
  messages: z.array(z.object({ id: z.uuid(), role: z.string(), content: z.string(), structuredPayload: z.record(z.string(), z.unknown()).nullable().optional() }).passthrough()),
}).passthrough();
/** Resolve only the requested owned conversation. History keeps the stage of each individual report. */
export function workspaceConversation(raw: unknown, conversationId: string) {
  const parsed = conversationSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== conversationId) return null;
  const value = parsed.data, assistants = value.messages.filter(message => message.role === 'assistant');
  const latest = assistants.at(-1), goal = goalBriefSchema.safeParse(latest?.structuredPayload?.goalBrief);
  let unavailableReports = 0;
  const reports = [...assistants].reverse().flatMap(message => {
    const rawReport = message.structuredPayload?.report;
    if (rawReport === undefined || rawReport === null) return [];
    const report = agentReportSchema.safeParse(rawReport);
    if (!report.success) { unavailableReports++; return []; }
    return [{ messageId: message.id, report: report.data, status: conversationGenerationOutcome('ANSWER', report.data).status }];
  });
  return { id: value.id, version: value.version, mode: value.mode, goal: goal.success ? goal.data : null, reports, unavailableReports,
    answer: latest?.structuredPayload?.result === 'ANSWER' && !latest.structuredPayload.report ? latest.content : null };
}
