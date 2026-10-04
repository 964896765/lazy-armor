import type { PropsWithChildren } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

export function ThemeBackground({ children }: PropsWithChildren) {
  return <ImageBackground source={require('../assets/backgrounds/planet-dawn.png')} resizeMode="cover" style={styles.background}><View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,35,55,0.08)' }]} />{children}</ImageBackground>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#B8D9F6' },
});
