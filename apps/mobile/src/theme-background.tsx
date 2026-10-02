import type { PropsWithChildren } from 'react';
import { ImageBackground, StyleSheet } from 'react-native';

export function ThemeBackground({ children }: PropsWithChildren) {
  return <ImageBackground source={require('../assets/backgrounds/planet-dawn.png')} resizeMode="cover" style={styles.background}>{children}</ImageBackground>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#B8D9F6' },
});
