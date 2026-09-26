import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

export default function PrivateSpacePage() {
  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>私密</Text>
    <View style={styles.card}><View style={styles.icon}><Ionicons name="lock-closed-outline" size={24} color={colors.primary} /></View><Text style={styles.cardTitle}>功能建设中</Text><Text style={styles.body}>真实敏感资料暂不开放录入。设备端独立加密、专门解锁、最小用途授权、撤权和恢复测试完成前，本页不会承诺保险库能力。</Text></View>
    <Text style={styles.boundary}>登录凭据和现有连接 Token 不会被当作私密保险库内容。</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text, marginVertical: spacing.md }, card: { alignItems: 'center', padding: spacing.xxl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.lg }, body: { ...typography.body, color: colors.textSecondary, lineHeight: 22, textAlign: 'center', marginTop: spacing.sm }, boundary: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.md },
});
