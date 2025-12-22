import type { ITheme } from '@xterm/xterm';
import { defaultTheme } from './default';
import { draculaTheme } from './dracula';
import { monokaiTheme } from './monokai';

/**
 * Available terminal themes
 */
export const themes: Record<string, ITheme> = {
  default: defaultTheme,
  dracula: draculaTheme,
  monokai: monokaiTheme,
};

/**
 * List of available theme names
 */
export const themeNames: string[] = Object.keys(themes);

/**
 * Get a theme by name
 * @param name - Theme name
 * @returns ITheme object or default theme if not found
 */
export function getTheme(name: string): ITheme {
  return themes[name] || themes.default;
}

// Export individual themes
export { defaultTheme } from './default';
export { draculaTheme } from './dracula';
export { monokaiTheme } from './monokai';
