import { useEffect, useRef, useCallback } from 'react';
import { KeyboardManager } from '../KeyboardManager';
import type { ShortcutOptions, Command } from '../types';

export function useShortcut(
  key: string,
  handler: () => void | Promise<void>,
  options: ShortcutOptions = {}
): void {
  const manager = useRef(KeyboardManager.getInstance()).current;
  const commandIdRef = useRef<string | undefined>(undefined);
  const handlerRef = useRef(handler);

  // Keep handler ref updated
  handlerRef.current = handler;

  // Stable callback wrapper
  const stableHandler = useCallback(async () => {
    await handlerRef.current();
  }, []);

  useEffect(() => {
    // Generate unique command ID
    const commandId = `shortcut-${Math.random().toString(36).substr(2, 9)}`;
    commandIdRef.current = commandId;

    // Create command
    const command: Command = {
      id: commandId,
      title: options.description || `Shortcut: ${key}`,
      handler: stableHandler,
      when: options.when,
      keybinding: {
        key,
        when: options.when,
        priority: options.priority || 0,
        args: {
          preventDefault: options.preventDefault !== false,
          stopPropagation: options.stopPropagation !== false,
        },
      },
    };

    // Register command
    const dispose = manager.registerCommand(command);

    // Cleanup
    return () => {
      dispose();
    };
  }, [key, options.when, options.description, options.priority, options.preventDefault, options.stopPropagation, stableHandler, manager]);
}

// Convenience hook for platform-specific shortcuts
export function usePlatformShortcut(
  macKey: string,
  winLinuxKey: string,
  handler: () => void | Promise<void>,
  options: ShortcutOptions = {}
): void {
  const manager = useRef(KeyboardManager.getInstance()).current;
  const normalizer = manager.getNormalizer();
  const key = normalizer.isMac() ? macKey : winLinuxKey;

  useShortcut(key, handler, options);
}