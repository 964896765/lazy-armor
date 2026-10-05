import { Redirect } from 'expo-router';
export default function LegacyEntry(){return <Redirect href={'/auth/login' as never}/>;}
