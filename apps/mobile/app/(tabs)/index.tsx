import { Redirect } from 'expo-router';
export default function LegacyHome() { return <Redirect href={'/schedule' as never} />; }
