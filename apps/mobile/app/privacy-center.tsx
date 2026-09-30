import { Redirect } from 'expo-router';

export default function LegacyPrivacyCenterRoute() {
  return <Redirect href={'/private' as never} />;
}
