import type { ITheme } from '@xterm/xterm';

/**
 * Default terminal theme
 * Based on Wave Terminal's default theme
 */
export const defaultTheme: ITheme = {
  foreground: '#d0d0d0',
  background: '#1a1a1a',
  cursor: '#ffffff',
  cursorAccent: '#000000',

  selectionBackground: 'rgba(255, 255, 255, 0.3)',
  selectionForeground: undefined,

  // Normal colors
  black: '#000000',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#d19a66',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',

  // Bright colors
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#d19a66',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};
