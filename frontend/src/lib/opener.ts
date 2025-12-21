/**
 * Opener compatibility shim for Wails
 *
 * Provides Tauri-like opener plugin API using Wails runtime.
 */

import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';

/**
 * Open a URL in the system default browser
 *
 * Uses Wails BrowserOpenURL runtime function.
 */
export async function openUrl(url: string): Promise<void> {
  try {
    BrowserOpenURL(url);
  } catch (err) {
    console.error('Failed to open URL:', err);
    // Fallback to window.open
    window.open(url, '_blank');
  }
}
