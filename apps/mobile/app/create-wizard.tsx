import { Redirect, useLocalSearchParams } from 'expo-router';
export default function LegacyCreationEntry() { const { scenarioKey, draftId } = useLocalSearchParams<{ scenarioKey?: string; draftId?: string }>(); return <Redirect href={{ pathname: '/chat', params: { mode: 'plan', ...(scenarioKey ? { scenarioKey } : {}), ...(draftId ? { draftId } : {}) } } as never} />; }
