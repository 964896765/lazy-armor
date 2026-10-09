import { StyleSheet, Text, View } from 'react-native';
import { presentGoalUnderstanding } from './goal-understanding-presenter';
import { consumerTokens } from './consumer-ui';
import { Button } from './editor-ui';

/** Interpretation only. Confirmation buttons remain bound to the server's saved proposal. */
export function GoalUnderstandingCard({ understanding, result, onResources }: { understanding: unknown; result?: string; onResources?: () => void }) {
  const view = presentGoalUnderstanding(understanding, result);
  if (!view) return null;
  return <View accessibilityLabel="AI理解的目标" style={styles.container}>
    <Text style={styles.label}>我理解的目标</Text>
    <Text selectable style={styles.title}>{view.title}</Text>
    <Text style={styles.detail}>{view.lifecycle} · AI 建议</Text>
    {view.timezone ? <Text style={styles.note}>理解时间所用时区：{view.timezone}</Text> : null}
    {view.capabilities.length ? <View style={styles.rows}>
      <Text style={styles.label}>需要的能力</Text>
      {view.capabilities.map((capability, index) => <View key={index} style={styles.rows}>
        <Text style={styles.detail}>{capability.name} · {capability.state}</Text>
        {capability.reasons.length ? <Text style={styles.detail}>{capability.reasons.join('、')}</Text> : null}
      </View>)}
      <Text style={styles.note}>执行前会再次检查权限和资源状态。</Text>
      {onResources ? <Button secondary label="核对所需资源" onPress={onResources} /> : null}
    </View> : null}
    {view.steps.length ? <Text style={styles.detail}>{view.steps.join(' → ')}</Text> : null}
    {view.missingRequirements.length ? <Text style={styles.detail}>{view.missingRequirements.join('\n')}</Text> : null}
    <Text style={styles.note}>{view.policy}</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D0D5DD' },
  rows: { gap: 4 },
  label: { fontSize: 12, color: consumerTokens.secondary },
  title: { fontSize: 16, fontWeight: '600', lineHeight: 24, color: consumerTokens.text },
  detail: { fontSize: 13, lineHeight: 20, color: consumerTokens.text },
  note: { fontSize: 12, lineHeight: 18, color: consumerTokens.secondary },
});
