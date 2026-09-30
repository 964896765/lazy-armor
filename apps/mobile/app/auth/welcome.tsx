import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ImageBackground, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomePage() {
  useEffect(() => {
    const timer = setTimeout(() => router.replace('/auth/login' as never), 1800);
    return () => clearTimeout(timer);
  }, []);

  return <Pressable accessibilityRole="button" accessibilityLabel="进入登录" onPress={() => router.replace('/auth/login' as never)} style={styles.page}>
    <StatusBar barStyle="light-content" backgroundColor="#050505" />
    <ImageBackground source={require('../../assets/launch-space-v7.png')} resizeMode="cover" style={styles.background}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.brandBlock}><View style={styles.logo}><Ionicons name="planet-outline" size={39} color="#FFFFFF" /></View><Text style={styles.brand}>懒人装甲</Text><Text style={styles.subtitle}>让复杂的事变简单</Text></View>
        <View style={styles.footer}><Text style={styles.motto}>从容有余，游刃有余</Text><View style={styles.rule} /><Text style={styles.hint}>轻触进入</Text></View>
      </SafeAreaView>
    </ImageBackground>
  </Pressable>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050505' }, background: { flex: 1 }, safeArea: { flex: 1, alignItems: 'center' },
  brandBlock: { alignItems: 'center', marginTop: '17%' }, logo: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center' }, brand: { color: '#FFFFFF', fontSize: 30, lineHeight: 39, fontWeight: '600', letterSpacing: 4, marginTop: 6 }, subtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 21, letterSpacing: 5, marginTop: 8 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 38, alignItems: 'center' }, motto: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontStyle: 'italic', letterSpacing: 4 }, rule: { width: 138, height: 1, marginTop: 11, backgroundColor: 'rgba(255,255,255,0.72)', transform: [{ rotate: '-4deg' }] }, hint: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 14, letterSpacing: 2 },
});
