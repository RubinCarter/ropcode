/**
 * Shell compatibility shim for Wails
 *
 * Provides Tauri-like shell API using browser APIs or Wails runtime.
 */

import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';

/**
 * Open a URL in the system default browser
 *
 * Uses Wails BrowserOpenURL runtime function.
 */
export async function open(url: string): Promise<void> {
  try {
    BrowserOpenURL(url);
  } catch (err) {
    console.error('Failed to open URL:', err);
    // Fallback to window.open
    window.open(url, '_blank');
  }
}
