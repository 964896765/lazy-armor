import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from './design';
import { buildSpaceDirectory } from './space-model';

const spaces = buildSpaceDirectory();

export function SpaceDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<string | null>('money');

  function open(path: string) {
    onClose();
    router.push(path as never);
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="关闭空间导航" onPress={onClose} style={styles.scrim} />
      <View style={[styles.drawer, { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.heading}>
          <View><Text style={styles.eyebrow}>懒人装甲</Text><Text style={styles.title}>我的空间</Text><Text style={styles.subtitle}>选择领域，再查看场景与计划</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={styles.close}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" onPress={() => open('/(tabs)')} style={styles.shortcut}><Ionicons name="sunny-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>今天</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => open('/(tabs)/plans')} style={styles.shortcut}><Ionicons name="grid-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>工作区与计划</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => open('/(tabs)/connections')} style={styles.shortcut}><Ionicons name="link-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>连接</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => open('/(tabs)/records')} style={styles.shortcut}><Ionicons name="time-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>记录</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => open('/security-center')} style={styles.shortcut}><Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>安全</Text></Pressable>
          <View style={styles.divider} />
          {spaces.map((space) => <View key={space.key} style={styles.space}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === space.key }} onPress={() => setExpanded(expanded === space.key ? null : space.key)} style={styles.spaceHead}>
              <View style={styles.spaceCopy}><Text style={styles.spaceName}>{space.label}</Text><Text style={styles.spaceDescription}>{space.description}</Text></View>
              <Ionicons name={expanded === space.key ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </Pressable>
            {expanded === space.key ? space.domains.map((domain) => <Pressable key={domain.key} accessibilityRole="button" onPress={() => open(`/domains/${domain.key}`)} style={styles.domain}>
              <Text style={styles.domainName}>{domain.label}</Text><Text style={styles.domainCount}>{domain.scenarioCount} 个场景</Text><Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
            </Pressable>) : null}
          </View>)}
          <View style={styles.divider} />
          <Pressable accessibilityRole="button" onPress={() => open('/(tabs)/me')} style={styles.shortcut}><Ionicons name="person-outline" size={19} color={colors.primary} /><Text style={styles.shortcutText}>我的账号与隐私</Text></Pressable>
          <Text style={styles.note}>空间只整理入口。场景可用性由当前账号的实时证据决定。</Text>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(22, 33, 58, 0.44)' },
  drawer: { width: '84%', maxWidth: 380, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: spacing.lg },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  title: { ...typography.title, color: colors.text, marginTop: spacing.xs },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  close: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  shortcut: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  shortcutText: { ...typography.bodyStrong, color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  space: { borderBottomWidth: 1, borderBottomColor: colors.border },
  spaceHead: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  spaceCopy: { flex: 1 },
  spaceName: { ...typography.bodyStrong, color: colors.text },
  spaceDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  domain: { minHeight: 42, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, gap: spacing.sm },
  domainName: { ...typography.body, color: colors.text, flex: 1 },
  domainCount: { ...typography.caption, color: colors.textMuted },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg, lineHeight: 18 },
});
