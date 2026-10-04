import { Redirect } from 'expo-router';
export default function NewPlan() { return <Redirect href={'/chat?mode=plan' as never} />; }
