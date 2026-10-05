import { Redirect } from 'expo-router';
export default function LegacyEntry(){return <Redirect href={'/chat?mode=plan' as never}/>;}
