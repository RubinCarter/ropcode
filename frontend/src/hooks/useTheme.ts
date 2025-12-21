import { useThemeContext } from '../contexts/ThemeContext';

/**
 * Hook to access and control the theme system
 *
 * @returns {Object} Theme utilities and state
 * @returns {ThemeMode} theme - Current theme mode ('dark' | 'gray' | 'light' | 'system' | 'custom')
 * @returns {'gray' | 'light'} systemTheme - Detected system theme (only relevant when theme is 'system')
 * @returns {CustomThemeColors} customColors - Custom theme color configuration
 * @returns {Function} setTheme - Function to change the theme mode
 * @returns {Function} setCustomColors - Function to update custom theme colors
 * @returns {boolean} isLoading - Whether theme operations are in progress
 *
 * @example
 * const { theme, systemTheme, setTheme } = useTheme();
 *
 * // Change theme
 * await setTheme('light');
 *
 * // Use system theme detection
 * if (theme === 'system') {
 *   console.log('Actual theme:', systemTheme); // 'gray' or 'light'
 * }
 *
 * // Update custom colors
 * await setCustomColors({ background: 'oklch(0.98 0.01 240)' });
 */
export const useTheme = () => {
  return useThemeContext();
};