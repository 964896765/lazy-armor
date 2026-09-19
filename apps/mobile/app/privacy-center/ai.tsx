import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { aiCapabilityCopy, visionPrivacyCopy } from '../../src/privacy-presenter';
import { ShellPage } from '../../src/shell';
import { colors, radius, spacing, typography } from '../../src/design';

export default function PrivacyAiPage() {
  const copy = aiCapabilityCopy();
  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="AI 与模型" subtitle="AI 只负责理解和建议，关键动作仍由你和系统安全边界共同决定。">
        <Text style={local.section}>AI 可以</Text>
        <View style={local.list}>
          {copy.allowed.map((item, index) => (
            <View key={item} style={[local.row, index < copy.allowed.length - 1 && local.divider]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={local.rowText}>{item}</Text>
            </View>
          ))}
        </View>
        <Text style={local.section}>AI 不可以</Text>
        <View style={local.list}>
          {copy.forbidden.map((item, index) => (
            <View key={item} style={[local.row, index < copy.forbidden.length - 1 && local.divider]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={local.rowText}>{item}</Text>
            </View>
          ))}
        </View>
        <View style={local.vision}>
          <Text style={local.visionTitle}>视觉读取</Text>
          <Text style={local.visionDescription}>{visionPrivacyCopy()}</Text>
        </View>
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  section: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  list: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', overflow: 'hidden' },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  rowText: { ...typography.body, color: colors.text },
  vision: { marginTop: spacing.lg, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', padding: spacing.md },
  visionTitle: { ...typography.bodyStrong, color: colors.text },
  visionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
});
