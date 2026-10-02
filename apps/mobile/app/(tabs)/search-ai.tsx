import { Redirect } from 'expo-router';

/** Historical deep-link compatibility. The canonical conversation route is /chat. */
export default function LegacySearchRedirect() {
  return <Redirect href={'/chat' as never} />;
}
