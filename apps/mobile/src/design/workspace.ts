import { colors } from './colors';

/** Workspace palette is independent of the existing navigation rail. */
export const workspaceColors = {
  ...colors,
  primary: '#008568',
  accent: '#008568',
  background: '#F2FAF8',
  surface: '#FFFFFF',
  text: '#111B38',
  textSecondary: '#657391',
  textMuted: '#8894AD',
  border: '#E3EEEF',
  accentSoft: '#E4F7EF',
  pressed: '#EFF9F5',
} as const;
