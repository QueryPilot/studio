/**
 * GlobalShortcutManager - Manages system-wide keyboard shortcuts
 *
 * This service provides a wrapper around Tauri's global-shortcut plugin,
 * allowing the app to register shortcuts that work even when the app is
 * in the background or minimized.
 */

import { isTauri } from '@/utils/tauri';

export type GlobalShortcutHandler = () => void | Promise<void>;

export interface GlobalShortcutConfig {
  shortcut: string;
  description: string;
  handler: GlobalShortcutHandler;
}

/**
 * Platform-specific shortcut formats:
 * - macOS: Command+Shift+Space
 * - Windows/Linux: Control+Shift+Space
 * - Cross-platform: CommandOrControl+Shift+Space (recommended)
 */
export class GlobalShortcutManager {
  private registeredShortcuts = new Map<string, GlobalShortcutConfig>();
  private isInitialized = false;

  /**
   * Initialize the global shortcut manager
   */
  async initialize(): Promise<void> {
    if (!isTauri()) {
      console.warn('[GlobalShortcutManager] Not running in Tauri, global shortcuts unavailable');
      return;
    }

    if (this.isInitialized) {
      console.warn('[GlobalShortcutManager] Already initialized');
      return;
    }

    try {
      const { isRegistered } = await import('@tauri-apps/plugin-global-shortcut');

      // Check if default shortcut is registered
      const defaultShortcut = 'CommandOrControl+Shift+Space';
      const registered = await isRegistered(defaultShortcut);

      if (registered) {
        console.log('[GlobalShortcutManager] Default global shortcut already registered:', defaultShortcut);
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('[GlobalShortcutManager] Failed to initialize:', error);
    }
  }

  /**
   * Register a global shortcut
   * @param config Shortcut configuration
   * @returns Promise<boolean> - true if registered successfully
   */
  async register(config: GlobalShortcutConfig): Promise<boolean> {
    if (!isTauri()) {
      console.warn('[GlobalShortcutManager] Cannot register shortcut: not in Tauri');
      return false;
    }

    try {
      const { register, isRegistered } = await import('@tauri-apps/plugin-global-shortcut');

      // Check if already registered
      const alreadyRegistered = await isRegistered(config.shortcut);
      if (alreadyRegistered) {
        console.warn(`[GlobalShortcutManager] Shortcut "${config.shortcut}" is already registered`);
        return false;
      }

      // Register the shortcut
      await register(config.shortcut, config.handler);

      // Store the config
      this.registeredShortcuts.set(config.shortcut, config);

      console.log(`[GlobalShortcutManager] Registered: ${config.shortcut} - ${config.description}`);
      return true;
    } catch (error) {
      console.error(`[GlobalShortcutManager] Failed to register "${config.shortcut}":`, error);
      return false;
    }
  }

  /**
   * Unregister a global shortcut
   * @param shortcut The shortcut to unregister
   * @returns Promise<boolean> - true if unregistered successfully
   */
  async unregister(shortcut: string): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }

    try {
      const { unregister } = await import('@tauri-apps/plugin-global-shortcut');

      await unregister(shortcut);
      this.registeredShortcuts.delete(shortcut);

      console.log(`[GlobalShortcutManager] Unregistered: ${shortcut}`);
      return true;
    } catch (error) {
      console.error(`[GlobalShortcutManager] Failed to unregister "${shortcut}":`, error);
      return false;
    }
  }

  /**
   * Unregister all global shortcuts
   */
  async unregisterAll(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    try {
      const { unregisterAll } = await import('@tauri-apps/plugin-global-shortcut');

      await unregisterAll();
      this.registeredShortcuts.clear();

      console.log('[GlobalShortcutManager] Unregistered all shortcuts');
    } catch (error) {
      console.error('[GlobalShortcutManager] Failed to unregister all:', error);
    }
  }

  /**
   * Check if a shortcut is registered
   * @param shortcut The shortcut to check
   * @returns Promise<boolean> - true if registered
   */
  async isRegistered(shortcut: string): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }

    try {
      const { isRegistered } = await import('@tauri-apps/plugin-global-shortcut');
      return await isRegistered(shortcut);
    } catch (error) {
      console.error(`[GlobalShortcutManager] Failed to check if "${shortcut}" is registered:`, error);
      return false;
    }
  }

  /**
   * Get all registered shortcuts
   * @returns Map of registered shortcuts
   */
  getRegisteredShortcuts(): Map<string, GlobalShortcutConfig> {
    return new Map(this.registeredShortcuts);
  }

  /**
   * Get the default global shortcut for showing the app
   * @returns The default shortcut string
   */
  getDefaultShowShortcut(): string {
    return 'CommandOrControl+Shift+Space';
  }

  /**
   * Format a shortcut string for display
   * Converts platform-agnostic shortcuts to platform-specific display
   */
  formatShortcutForDisplay(shortcut: string): string {
    const isMac = typeof navigator !== 'undefined' &&
                  navigator.userAgent.toLowerCase().includes('mac');

    let formatted = shortcut;

    if (isMac) {
      formatted = formatted
        .replace(/CommandOrControl/g, '⌘')
        .replace(/Command/g, '⌘')
        .replace(/Shift/g, '⇧')
        .replace(/Alt/g, '⌥')
        .replace(/Control/g, '⌃')
        .replace(/Option/g, '⌥');
    } else {
      formatted = formatted
        .replace(/CommandOrControl/g, 'Ctrl')
        .replace(/Command/g, 'Ctrl');
    }

    return formatted;
  }

  /**
   * Validate a shortcut string format
   * @param shortcut The shortcut to validate
   * @returns true if valid
   */
  validateShortcut(shortcut: string): boolean {
    // Basic validation: must have at least one modifier and one key
    const validModifiers = ['CommandOrControl', 'Command', 'Control', 'Shift', 'Alt', 'Option', 'Super'];
    const parts = shortcut.split('+');

    if (parts.length < 2) {
      return false;
    }

    // Check if at least one modifier exists
    const hasModifier = parts.some(part => validModifiers.includes(part));
    return hasModifier;
  }
}

// Singleton instance
let globalShortcutManager: GlobalShortcutManager | null = null;

/**
 * Get the global shortcut manager singleton
 */
export function getGlobalShortcutManager(): GlobalShortcutManager {
  if (!globalShortcutManager) {
    globalShortcutManager = new GlobalShortcutManager();
  }
  return globalShortcutManager;
}

/**
 * React hook for using global shortcuts
 */
export function useGlobalShortcut(config: GlobalShortcutConfig) {
  const manager = getGlobalShortcutManager();

  // Register on mount
  React.useEffect(() => {
    let registered = false;

    const registerShortcut = async () => {
      registered = await manager.register(config);
    };

    void registerShortcut();

    // Cleanup on unmount
    return () => {
      if (registered) {
        void manager.unregister(config.shortcut);
      }
    };
  }, [config.shortcut, config.description]);
}

// Import React for hook
import React from 'react';
