import { useMemo } from 'react';
import { KeyboardManager } from '../KeyboardManager';

export function useKeybindingHint(commandId: string): string | undefined {
  const manager = KeyboardManager.getInstance();
  const normalizer = manager.getNormalizer();

  return useMemo(() => {
    const keybinding = manager.getKeybinding(commandId);
    if (!keybinding?.key) return undefined;

    // Convert to platform-specific display format
    return normalizer.toPlatform(keybinding.key);
  }, [commandId, manager, normalizer]);
}

// Get all keybindings for display (e.g., in settings or help)
export function useAllKeybindings(): Map<string, string> {
  const manager = KeyboardManager.getInstance();
  const normalizer = manager.getNormalizer();

  return useMemo(() => {
    const result = new Map<string, string>();
    const commands = manager.getAllCommands();

    commands.forEach(command => {
      if (command.keybinding?.key) {
        const displayKey = normalizer.toPlatform(command.keybinding.key);
        result.set(command.id, displayKey);
      }
    });

    return result;
  }, [manager, normalizer]);
}