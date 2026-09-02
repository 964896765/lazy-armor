import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { styles } from '../src/shell';

interface FileImportResult {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  recordCount: number;
  duplicate: boolean;
}

export default function FileImportPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const importFile = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('AUTH_REQUIRED');
      const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/json'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled) return null;
      const asset = picked.assets[0];
      if (!asset || !asset.size || asset.size > 1_000_000) throw new Error('FILE_SIZE');
      const extension = asset.name.toLowerCase().split('.').pop();
      const mimeType = extension === 'csv' ? 'text/csv' : extension === 'json' ? 'application/json' : null;
      if (!mimeType) throw new Error('FILE_TYPE');
      const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      return api<FileImportResult>('/file-imports/billing', token, {
        method: 'POST',
        body: JSON.stringify({
          fileName: asset.name,
          mimeType,
          contentBase64,
          idempotencyKey: `mobile:${asset.name}:${asset.size}:${Date.now()}`,
        }),
      });
    },
    onSuccess: async (result) => {
      if (!result) { setMessage('你取消了选择，没有读取任何文件。'); return; }
      setMessage(result.duplicate ? `这份文件已经处理过，共 ${result.recordCount} 条账单。` : `已导入 ${result.recordCount} 条账单。`);
      await client.invalidateQueries({ queryKey: ['billing-records'] });
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : '';
      if (code === 'FILE_SIZE') setMessage('文件需要小于 1 MB，没有导入任何内容。');
      else if (code === 'FILE_TYPE') setMessage('请选择 CSV 或 JSON 账单文件。');
      else setMessage('文件没有导入成功，已有账单没有被修改。');
    },
  });

  return <ScrollView style={local.page} contentContainerStyle={local.content}>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>选择账单文件</Text>
      <Text style={styles.cardText}>支持不超过 1 MB 的 CSV 或 JSON。只保存解析后的账单和必要来源信息，原文件内容不会写入记录或安全日志。</Text>
      <View style={local.action}><Button title={importFile.isPending ? '读取中…' : '选择文件'} onPress={() => importFile.mutate()} disabled={!token || importFile.isPending} /></View>
      {importFile.isPending && <ActivityIndicator />}
      {message && <Text style={local.message}>{message}</Text>}
      {!token && <Text style={local.message}>请先登录再导入。</Text>}
    </View>
  </ScrollView>;
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 20 }, action: { marginTop: 16 },
  message: { color: '#5E6A63', marginTop: 14, lineHeight: 20 },
});
