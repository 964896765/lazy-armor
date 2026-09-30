import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkspaceHeader, workspaceColors as colors, radius, spacing, typography } from '../src/design';

const FEATURES = {
  'login-devices': { title: '登录与设备', detail: '当前登录、会话和账号可信设备将在这里统一管理。' },
  'personal-privacy': { title: '个人隐私设置', detail: '个人信息使用、个性化与隐私选择将在这里统一设置。' },
  preferences: { title: '偏好设置', detail: '内容偏好、界面偏好与个性化推荐将在这里设置。' },
  'ai-habits': { title: 'AI 助手习惯', detail: '对话风格和个人交互偏好将在这里设置，不与问一问的对话历史混用。' },
  help: { title: '帮助与反馈', detail: '使用帮助、问题反馈与处理进度将在这里提供。' },
  about: { title: '关于懒人装甲', detail: '版本、服务协议、隐私政策与产品信息将在这里展示。' },
  'service-publishing': { title: '发布管理', detail: '服务、商品、方案和需求的发布管理将在这里建设，不会转入待办冒充已发布。' },
  'service-following': { title: '关注与收藏', detail: '关注的发布者、服务和收藏内容将在这里统一管理。' },
  'service-settings': { title: '服务设置', detail: '服务通知、接单规则与展示偏好将在这里设置。' },
} as const;

export default function FeaturePlaceholder() {
  const params = useLocalSearchParams<{ feature?: string }>();
  const feature = FEATURES[params.feature as keyof typeof FEATURES] ?? { title: '功能入口', detail: '该页面尚未建设。' };
  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <WorkspaceHeader title={feature.title} onBack={() => router.back()} />
    <View style={styles.empty}><View style={styles.icon}><Ionicons name="construct-outline" size={25} color={colors.primary} /></View><Text style={styles.title}>尚未建设</Text><Text style={styles.detail}>{feature.detail}</Text><Text style={styles.note}>入口与职责已经确定，后续将复用统一的列表、详情或设置组件补全。</Text></View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  empty: { alignItems: 'center', marginTop: 88, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 27, backgroundColor: colors.successSoft },
  title: { ...typography.section, color: colors.text, marginTop: spacing.md }, detail: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 23, marginTop: spacing.sm },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'center', lineHeight: 19, marginTop: spacing.md },
});
