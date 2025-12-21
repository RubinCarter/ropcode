/**
 * Path utilities for displaying file paths in a more readable format
 */

/**
 * Shortens a file path for display purposes:
 * - If workspacePath is provided and the file is within it, show relative path
 * - Otherwise, show the absolute path
 *
 * @param filePath - The absolute file path to shorten
 * @param workspacePath - Optional workspace path
 * @returns The shortened path for display
 */
export function shortenPath(filePath: string, workspacePath?: string): string {
  if (!filePath) {
    return filePath;
  }

  // If workspace path is provided, try to make the path relative
  if (workspacePath) {
    const normalizedWorkspace = workspacePath.replace(/\/$/, '');
    const normalizedPath = filePath.replace(/\/$/, '');

    if (normalizedPath.startsWith(normalizedWorkspace + '/')) {
      return normalizedPath.slice(normalizedWorkspace.length + 1);
    }
  }

  // Return absolute path
  return filePath;
}
