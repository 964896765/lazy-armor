import { Redirect } from 'expo-router';
export default function LegacySearch() { return <Redirect href={'/chat' as never} />; }
