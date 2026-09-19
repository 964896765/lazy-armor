import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ActionButton, colors } from '../src/design';
import { clarificationQuestion, presentAgentPlanProposal } from '../src/privacy-presenter';
import { AuthPage, styles } from './auth/login';

interface AgentPlannerResult {
  result: 'ANSWER' | 'PLAN_DRAFT' | 'CLARIFICATION_REQUIRED' | 'PLANNER_OUTPUT_INVALID';
  proposal?: {
    intentSummary?: string | null;
    explanation?: string | null;
    requiredFacts?: string[];
    requiredCapabilities?: string[];
    toolRequirements?: Array<{ toolName: string; requiresApproval: boolean }>;
    warnings?: string[];
  };
  answer?: { explanation: string };
  clarification?: { missingRequirements: string[] };
}

export default function OnboardingPage() {
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const token = useAuthStore((state) => state.token);
  const [intent, setIntent] = useState('');
  const agentPlan = useMutation({
    mutationFn: () => api<AgentPlannerResult>('/templates/natural-language/agent', token, { method: 'POST', body: JSON.stringify({ query: intent.trim() }) }),
  });

  const continueToApp = async () => {
    await completeOnboarding();
    router.replace('/' as never);
  };

  return <AuthPage title="先把边界说清楚" subtitle="懒人装甲会帮你管理事务，但不会替你越过授权边界。">
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>你始终掌握控制权</Text>
      <Text style={styles.infoCopy}>计划会显示数据来源、触发条件、执行动作和风险等级。需要确认的事项会先向你请求审批。</Text>
    </View>
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>敏感操作默认保守</Text>
      <Text style={styles.infoCopy}>涉及资金、账户权限和外部写入的操作，未完成安全验证前不会自动执行。</Text>
    </View>
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>从一个小计划开始</Text>
      <Text style={styles.infoCopy}>你可以先从模板库挑选一件想少操心的小事，随时暂停、修改或删除计划。</Text>
    </View>
    <TextInput style={styles.input} accessibilityLabel="描述你想交给懒人装甲的第一件事" placeholder="例如：净水器滤芯快到期时提醒我" placeholderTextColor={colors.textMuted} value={intent} onChangeText={(value) => { setIntent(value); agentPlan.reset(); }} />
    <View style={styles.action}><ActionButton label={agentPlan.isPending ? '理解中…' : '让装甲理解一下'} tone="quiet" onPress={() => agentPlan.mutate()} disabled={agentPlan.isPending || !intent.trim()} /></View>
    {agentPlan.data?.result === 'PLAN_DRAFT' && agentPlan.data.proposal ? <AgentProposalPreview proposal={agentPlan.data.proposal} /> : null}
    {agentPlan.data?.result === 'CLARIFICATION_REQUIRED' ? <Text style={styles.success}>{clarificationQuestion(agentPlan.data.clarification?.missingRequirements ?? [])}</Text> : null}
    {agentPlan.data?.result === 'ANSWER' && agentPlan.data.answer ? <Text style={styles.success}>{agentPlan.data.answer.explanation}</Text> : null}
    <View style={styles.action}><ActionButton label="我明白了，开始使用" onPress={() => void continueToApp()} /></View>
  </AuthPage>;
}

function AgentProposalPreview({ proposal }: { proposal: NonNullable<AgentPlannerResult['proposal']> }) {
  const presentation = presentAgentPlanProposal(proposal);
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>{presentation.title}</Text>
      <Text style={styles.infoCopy}>{presentation.intent}</Text>
      <Text style={styles.infoCopy}>{presentation.dataUsed} · {presentation.connectionsNeeded}</Text>
      {presentation.needsConfirmation ? <Text style={styles.infoCopy}>部分动作执行前会先请你确认，不会自动执行。</Text> : null}
    </View>
  );
}
