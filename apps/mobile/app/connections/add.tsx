import { Redirect } from 'expo-router';

export default function LegacyAddConnection() {
  return <Redirect href={'/phone-apps' as never} />;
}
