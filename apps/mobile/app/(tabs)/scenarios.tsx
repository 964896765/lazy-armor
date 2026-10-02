import { Redirect } from 'expo-router';

/** Historical deep-link compatibility. Plan templates now live in the plan workspace. */
export default function LegacyScenariosRedirect() {
  return <Redirect href={'/plans' as never} />;
}
