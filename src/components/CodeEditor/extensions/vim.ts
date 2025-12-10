/**
 * Vim Mode Extension
 *
 * Provides vim keybindings using @replit/codemirror-vim.
 */

import { vim } from "@replit/codemirror-vim";
import type { Extension } from "@codemirror/state";

export interface VimConfig {
  enabled: boolean;
}

/**
 * Create vim mode extension
 */
export function createVimExtension(config: VimConfig = { enabled: true }): Extension[] {
  if (!config.enabled) return [];
  return [vim()];
}
