import { Redirect, useLocalSearchParams } from 'expo-router';
export default function LegacyCreate() { const params = useLocalSearchParams<{ intent?: string; templateKey?: string }>(); return <Redirect href={{ pathname: '/chat', params: { mode: 'plan', ...params } } as never} />; }
