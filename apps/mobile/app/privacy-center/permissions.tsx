import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { devicePermissionCopy, visionPrivacyCopy } from '../../src/privacy-presenter';
import { ShellPage } from '../../src/shell';
import { colors, radius, spacing, typography } from '../../src/design';

export default function PrivacyPermissionsPage() {
  const permissions = devicePermissionCopy();
  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="设备权限" subtitle="通知监听可在系统授权后后台接收通知；受控应用读取必须满足会话与前台限制。">
        <View style={local.list}>
          {permissions.map((permission, index) => (
            <View key={permission.key} style={[local.row, index < permissions.length - 1 && local.divider]}>
              <View style={local.icon}><Ionicons name={permissionIcon(permission.key)} size={19} color={colors.primary} /></View>
              <View style={local.copy}>
                <Text style={local.title}>{permission.title}</Text>
                <Text style={local.description}>{permission.description}</Text>
              </View>
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

function permissionIcon(key: string) {
  if (key === 'notification_read') return 'notifications-outline';
  if (key === 'share_receive') return 'share-outline';
  if (key === 'foreground_app_read') return 'phone-portrait-outline';
  if (key === 'structured_read') return 'list-outline';
  return 'scan-outline';
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', overflow: 'hidden' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  vision: { marginTop: spacing.lg, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', padding: spacing.md },
  visionTitle: { ...typography.bodyStrong, color: colors.text },
  visionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
});
