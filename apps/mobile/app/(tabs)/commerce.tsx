import { Redirect } from 'expo-router';

/** Historical deep-link compatibility. The consumer workspace is now 服务. */
export default function LegacyCommerceRedirect() {
  return <Redirect href={'/services' as never} />;
}
