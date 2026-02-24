/**
 * Clipboard utility that uses Tauri's native clipboard plugin.
 *
 * This module provides clipboard operations using @tauri-apps/plugin-clipboard-manager
 * which bypasses browser permission dialogs and works reliably in the Tauri environment.
 *
 * @see https://v2.tauri.app/plugin/clipboard/
 */

import { isTauri } from "@/utils/tauri";

/**
 * Read text from the system clipboard.
 * Uses Tauri's native clipboard plugin for reliable access without permission dialogs.
 *
 * @returns The clipboard text content, or empty string if clipboard is empty
 * @throws Error if clipboard access fails
 */
export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    const text = await readText();
    return text ?? "";
  }

  // Fallback to browser API for non-Tauri environments (e.g., dev in browser)
  if (navigator.clipboard?.readText) {
    return await navigator.clipboard.readText();
  }

  throw new Error("Clipboard API not available");
}

/**
 * Write text to the system clipboard.
 * Uses Tauri's native clipboard plugin for reliable access without permission dialogs.
 *
 * @param text The text to write to the clipboard
 * @throws Error if clipboard access fails
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }

  // Fallback to browser API for non-Tauri environments (e.g., dev in browser)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard API not available");
}

/**
 * Check if clipboard operations are available.
 */
export function isClipboardAvailable(): boolean {
  return isTauri() || Boolean(navigator.clipboard);
}
