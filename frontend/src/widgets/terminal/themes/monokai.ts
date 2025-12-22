import type { ITheme } from '@xterm/xterm';

/**
 * Monokai terminal theme
 * A classic color scheme with warm tones
 */
export const monokaiTheme: ITheme = {
  foreground: '#f8f8f2',
  background: '#272822',
  cursor: '#f8f8f0',
  cursorAccent: '#272822',

  selectionBackground: 'rgba(73, 72, 62, 0.6)',
  selectionForeground: undefined,

  // Normal colors
  black: '#272822',
  red: '#f92672',
  green: '#a6e22e',
  yellow: '#f4bf75',
  blue: '#66d9ef',
  magenta: '#ae81ff',
  cyan: '#a1efe4',
  white: '#f8f8f2',

  // Bright colors
  brightBlack: '#75715e',
  brightRed: '#f92672',
  brightGreen: '#a6e22e',
  brightYellow: '#e6db74',
  brightBlue: '#66d9ef',
  brightMagenta: '#ae81ff',
  brightCyan: '#a1efe4',
  brightWhite: '#f9f8f5',
};
