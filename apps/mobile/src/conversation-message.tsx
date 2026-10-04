import { Platform, StyleSheet, Text, View } from 'react-native';
import { conversationContent } from './conversation-content';

export function ConversationMessage({ content }: { content: string }) {
  return <View style={styles.container}><Text selectable textBreakStrategy="simple" style={styles.text}>{conversationContent(content)}</Text></View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', minWidth: 0, flexShrink: 1 },
  text: { fontSize: 14, lineHeight: 22, color: '#172033', width: '100%', flexShrink: 1, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}) },
});
