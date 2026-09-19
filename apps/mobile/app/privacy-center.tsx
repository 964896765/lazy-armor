import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { privacyCenterSections } from '../src/privacy-presenter';
import { ShellPage } from '../src/shell';
import { colors, radius, spacing, typography } from '../src/design';

export default function PrivacyCenterPage() {
  const sections = privacyCenterSections();
  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="隐私中心" subtitle="集中查看你的数据、授权、设备权限与 AI 使用边界。">
        <View style={local.menu}>
          {sections.map((section, index) => (
            <View key={section.key}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(section.route as Href)}
                style={({ pressed }) => [local.row, pressed && local.pressed]}
              >
                <View style={local.icon}><Ionicons name={section.icon as ComponentProps<typeof Ionicons>['name']} size={20} color={colors.primary} /></View>
                <View style={local.copy}>
                  <Text style={local.title}>{section.title}</Text>
                  <Text style={local.description}>{section.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
              {index < sections.length - 1 ? <View style={local.divider} /> : null}
            </View>
          ))}
        </View>
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  menu: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', overflow: 'hidden' },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pressed: { backgroundColor: '#F7F8FA' },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: '#EAECF0', marginLeft: 64 },
});
