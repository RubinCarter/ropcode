import { create } from 'zustand';
import type { StateCreator } from 'zustand';

/**
 * Terminal Widget 配置状态
 */
interface TerminalState {
  // Terminal 配置
  fontSize: number;
  themeName: string;
  transparency: number;
  allowBracketedPaste: boolean;
  cursorBlink: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  scrollback: number;

  // Actions
  setFontSize: (size: number) => void;
  setTheme: (name: string) => void;
  setTransparency: (value: number) => void;
  setCursorBlink: (blink: boolean) => void;
  setCursorStyle: (style: 'block' | 'underline' | 'bar') => void;
  setScrollback: (lines: number) => void;
  resetToDefaults: () => void;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  fontSize: 14,
  themeName: 'default',
  transparency: 1,
  allowBracketedPaste: true,
  cursorBlink: true,
  cursorStyle: 'block' as const,
  scrollback: 5000,
};

const terminalStore: StateCreator<TerminalState> = (set) => ({
  // Initial state
  ...DEFAULT_CONFIG,

  // Set font size
  setFontSize: (size: number) => {
    if (size < 8 || size > 32) {
      console.warn(`Font size ${size} is out of range [8, 32]`);
      return;
    }
    set({ fontSize: size });
  },

  // Set theme
  setTheme: (name: string) => {
    set({ themeName: name });
  },

  // Set transparency
  setTransparency: (value: number) => {
    if (value < 0 || value > 1) {
      console.warn(`Transparency ${value} is out of range [0, 1]`);
      return;
    }
    set({ transparency: value });
  },

  // Set cursor blink
  setCursorBlink: (blink: boolean) => {
    set({ cursorBlink: blink });
  },

  // Set cursor style
  setCursorStyle: (style: 'block' | 'underline' | 'bar') => {
    set({ cursorStyle: style });
  },

  // Set scrollback lines
  setScrollback: (lines: number) => {
    if (lines < 0 || lines > 100000) {
      console.warn(`Scrollback ${lines} is out of range [0, 100000]`);
      return;
    }
    set({ scrollback: lines });
  },

  // Reset to defaults
  resetToDefaults: () => {
    set(DEFAULT_CONFIG);
  },
});

export const useTerminalStore = create<TerminalState>()(terminalStore);
