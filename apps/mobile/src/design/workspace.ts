import { colors } from './colors';

/** Workspace palette is independent of the existing navigation rail. */
export const workspaceColors = {
  ...colors,
  primary: '#496D5D',
  accent: '#496D5D',
  background: '#FAF8F3',
  surface: '#FFFEFB',
  text: '#292D2A',
  textSecondary: '#667068',
  textMuted: '#8D948E',
  border: '#E7E3DA',
  accentSoft: '#E8F0EB',
  successSoft: '#E7F0EA',
  pressed: '#F1EFE9',
} as const;
