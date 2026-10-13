import { api } from './api';

export interface LoginMethods {
  passwordLogin: boolean;
  passwordRegistration: boolean;
  codeLogin: Record<'phone' | 'email', 'LOCAL_DEVELOPMENT' | 'CONFIGURED' | 'UNAVAILABLE'>;
}
export const fetchLoginMethods = () => api<LoginMethods>('/auth/methods');

export interface SecurityMethods {
  identifiers: Array<{kind:'email'|'phone'; masked:string; verified:boolean}>;
  passwordConfigured: boolean;
  canSetPassword: boolean;
  canVerifyEmail: boolean;
  passkeysAvailable: boolean;
}
