import type { AppRole } from '../common/app-role';

/**
 * Development commands may infer their role from the chosen entrypoint. In production
 * the environment must declare APP_ROLE itself so ConfigModule can reject an accidental
 * multi-purpose process before application modules are initialized.
 */
export function prepareEntrypointRole(expected: AppRole): void {
  const configured = process.env.APP_ROLE;
  if (!configured) {
    if (process.env.NODE_ENV !== 'production') process.env.APP_ROLE = expected;
    return;
  }
  if (configured !== expected) {
    throw new Error(`Entrypoint for ${expected} cannot run with APP_ROLE=${configured}`);
  }
}
