import { api } from './api';

export interface LoginMethods {
  passkeyLogin?: {available:boolean;origins:string[]};
  passwordLogin: boolean;
  passwordRegistration: boolean;
  smsRequestProtection?: {enabled:boolean;clientMarkerRequired:boolean;retentionDays:number};
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
  passkeys?: {available:boolean;origins:string[];sources:Array<{id:string;kind:'email'|'phone';masked:string}>;credentials:Array<{id:string;label:string;createdAt:string;lastUsedAt:string|null;backedUp:boolean}>};
  passwordLoginKinds?: Array<'email'|'phone'>;
  emailBinding?: { available: boolean; sources: Array<{id:string;kind:'email'|'phone';masked:string}> };
  phoneBinding?: { available: boolean; sources: Array<{id:string;kind:'email'|'phone';masked:string}> };
  phoneChange?: { available: boolean; sources: Array<{id:string;kind:'email'|'phone';masked:string}>; phones:Array<{id:string;masked:string}> };
  securityNotices?: Array<{channel:string;masked:string;state:string;createdAt:string}>;
}
