import { api } from './api';

export interface LoginMethods {
  passwordLogin: boolean;
  passwordRegistration: boolean;
  passwordIdentifiers?: Array<'email'|'phone'>;
  passwordRecovery?: {available:boolean;emailAliases:boolean};
  codeLogin: Record<'phone' | 'email', 'LOCAL_DEVELOPMENT' | 'CONFIGURED' | 'UNAVAILABLE'>;
}
export const fetchLoginMethods = () => api<LoginMethods>('/auth/methods');

export interface SecurityMethods {
  identifiers: Array<{kind:'email'|'phone'; masked:string; verified:boolean; recoveryEnabled?:boolean}>;
  passwordConfigured: boolean;
  canSetPassword: boolean;
  canVerifyEmail: boolean;
  passkeysAvailable: boolean;
  passwordLoginKinds?: Array<'email'|'phone'>;
  emailBinding?: { available: boolean; sources: Array<{id:string;kind:'email'|'phone';masked:string}> };
  phoneBinding?: { available: boolean; sources: Array<{id:string;kind:'email'|'phone';masked:string}> };
}
