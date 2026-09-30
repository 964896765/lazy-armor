import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkspaceHeader, workspaceColors as colors, spacing, typography } from '../src/design';

export default function PrivateSpace() {
  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <WorkspaceHeader title="私密空间" onBack={() => router.back()} />
    <View style={styles.hero}><View style={styles.copy}><Text style={styles.state}>受限入口</Text><Text style={styles.title}>敏感资料存储暂未开放</Text><Text style={styles.detail}>私密空间不会继承普通资源或 AI 的读取授权。只有本地加密、独立解锁、权限撤销和安全测试完成后，才会开放真实资料存储。</Text></View></View>
    <Text style={styles.sectionTitle}>开放前必须完成</Text>
    {['本地加密存储', '独立解锁与恢复验证', '按用途单独授权并可随时撤销', '完整访问记录与安全测试'].map((item) => <View key={item} style={styles.row}><Ionicons name="ellipse-outline" size={17} color={colors.textMuted} /><Text style={styles.rowText}>{item}</Text></View>)}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  hero: { paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, copy: { flex: 1 },
  state: { ...typography.caption, color: colors.warning, fontWeight: '800' }, title: { ...typography.section, color: colors.text, marginTop: 3 }, detail: { ...typography.body, color: colors.textSecondary, lineHeight: 23, marginTop: spacing.sm },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }, row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowText: { ...typography.body, color: colors.text },
});
