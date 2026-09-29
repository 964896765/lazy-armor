import { colors } from './colors';

/** Workspace palette is independent of the existing navigation rail. */
export const workspaceColors = {
  ...colors,
  primary: '#222826',
  accent: '#222826',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#171717',
  textSecondary: '#686868',
  textMuted: '#999999',
  border: '#EAEAEA',
  accentSoft: '#F5F5F4',
  successSoft: '#EEF7F1',
  pressed: '#F5F5F4',
} as const;
