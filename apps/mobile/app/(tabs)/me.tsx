import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { ShellPage, styles } from '../../src/shell';

export default function Me() {
  return <ShellPage title="我的" subtitle="连接与权限必须容易查看，也必须容易撤销。"><Link href="/connections" asChild><Pressable><View style={styles.card}><Text style={styles.cardTitle}>我的连接</Text><Text style={styles.cardText}>查看服务状态、逐项权限和撤销连接</Text></View></Pressable></Link></ShellPage>;
}
