import { Redirect } from 'expo-router';

// New accounts prove their email first; optional passwords are set in security.
export default function RegisterPage() { return <Redirect href={'/auth/login' as never} />; }
