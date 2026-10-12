import { api } from './api';

export interface LoginMethods {
  passwordLogin: boolean;
  passwordRegistration: boolean;
  codeLogin: Record<'phone' | 'email', 'LOCAL_DEVELOPMENT' | 'CONFIGURED' | 'UNAVAILABLE'>;
}
export const fetchLoginMethods = () => api<LoginMethods>('/auth/methods');
