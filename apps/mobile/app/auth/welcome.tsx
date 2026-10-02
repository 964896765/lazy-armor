import { router } from 'expo-router';
import { useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Policy = '用户协议' | '隐私政策';

export default function WelcomePage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const decline = () => {
    if (Platform.OS === 'android') BackHandler.exitApp();
    else setPolicy('隐私政策');
  };
  return <SafeAreaView style={styles.safeArea}>
    <View style={styles.center}>
      <View style={styles.panel}>
        <Text style={styles.title}>欢迎使用懒人装甲</Text>
        <Text style={styles.copy}>为了向你提供完整服务，请仔细阅读并充分理解 <Text style={styles.link} onPress={() => setPolicy('用户协议')}>《用户协议》</Text> 和 <Text style={styles.link} onPress={() => setPolicy('隐私政策')}>《隐私政策》</Text>。点击同意后，我们将按照你授权的范围使用相关信息。</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/auth/login' as never)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><Text style={styles.primaryText}>同意并继续登录</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={decline} style={({ pressed }) => [styles.decline, pressed && styles.pressed]}><Text style={styles.declineText}>不同意</Text></Pressable>
      </View>
      <Text style={styles.brand}>懒人装甲 · 让重要的事自动向前</Text>
    </View>
    <Modal visible={Boolean(policy)} transparent animationType="fade" onRequestClose={() => setPolicy(null)}>
      <View style={styles.modalBackdrop}><View style={styles.policyPanel}><Text style={styles.policyTitle}>{policy}</Text><Text style={styles.policyCopy}>{policy === '用户协议' ? '你可以自主选择使用哪些功能，并随时停止使用。涉及账号、连接、授权和外部操作时，应用会明确说明并等待你的确认。' : '应用只在你明确授权后读取所选来源。敏感凭据安全存储；你可以在设置中查看、撤回连接和管理数据。'}</Text><Pressable accessibilityRole="button" onPress={() => setPolicy(null)} style={styles.policyButton}><Text style={styles.policyButtonText}>我知道了</Text></Pressable></View></View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, center: { flex: 1, justifyContent: 'center', paddingHorizontal: 26 }, panel: { marginTop: 88, paddingHorizontal: 22, paddingTop: 30, paddingBottom: 20, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.95)' },
  title: { color: '#202733', fontSize: 25, lineHeight: 34, fontWeight: '700', textAlign: 'center' }, copy: { marginTop: 20, color: '#303945', fontSize: 16, lineHeight: 28 }, link: { color: '#2388C9', fontWeight: '600' }, primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 16, backgroundColor: '#25282E' }, primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, decline: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 5 }, declineText: { color: '#57606D', fontSize: 16 }, brand: { marginTop: 22, color: 'rgba(38,51,68,0.62)', fontSize: 14, textAlign: 'center' }, pressed: { opacity: 0.68 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: 'rgba(22,35,54,0.35)' }, policyPanel: { padding: 24, borderRadius: 24, backgroundColor: '#FFFFFF' }, policyTitle: { color: '#202733', fontSize: 22, fontWeight: '700' }, policyCopy: { marginTop: 16, color: '#4A5563', fontSize: 15, lineHeight: 25 }, policyButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 22, borderRadius: 14, backgroundColor: '#EAF4FC' }, policyButtonText: { color: '#176B9F', fontSize: 16, fontWeight: '700' },
});
