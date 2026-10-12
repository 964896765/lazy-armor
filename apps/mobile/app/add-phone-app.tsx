import { Redirect } from 'expo-router';

export default function LegacyAddPhoneApp() {
  return <Redirect href={'/phone-apps' as never} />;
}
