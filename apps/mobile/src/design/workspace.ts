import { colors } from './colors';

/** Workspace palette is independent of the existing navigation rail. */
export const workspaceColors = {
  ...colors,
  primary: '#2F80ED',
  accent: '#4B96F3',
  background: 'transparent',
  surface: '#FFFFFF',
  text: '#152033',
  textSecondary: '#607086',
  textMuted: '#8B98AA',
  border: '#E4EAF2',
  accentSoft: '#EAF3FF',
  successSoft: '#EEF7F1',
  pressed: '#EDF5FF',
} as const;
