import type { ITheme } from '@xterm/xterm';

/**
 * Dracula terminal theme
 * A dark theme with vibrant colors
 * https://draculatheme.com/
 */
export const draculaTheme: ITheme = {
  foreground: '#f8f8f2',
  background: '#282a36',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',

  selectionBackground: 'rgba(68, 71, 90, 0.5)',
  selectionForeground: undefined,

  // Normal colors
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',

  // Bright colors
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};
