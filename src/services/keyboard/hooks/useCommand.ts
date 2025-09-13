import { useEffect, useRef, useCallback, useState } from 'react';
import { KeyboardManager } from '../KeyboardManager';
import type { Command } from '../types';

interface UseCommandResult {
  execute: (args?: any) => Promise<void>;
  isEnabled: boolean;
  keybinding?: string;
  setKeybinding: (key: string) => void;
  removeKeybinding: () => void;
}

export function useCommand(command: Command): UseCommandResult {
  const manager = KeyboardManager.getInstance();
  const [isEnabled, setIsEnabled] = useState(true);
  const [keybinding, setKeybindingState] = useState<string | undefined>(
    command.keybinding?.key
  );
  const commandRef = useRef(command);

  // Keep command ref updated
  commandRef.current = command;

  // Register command
  useEffect(() => {
    const dispose = manager.registerCommand(command);

    // Subscribe to context changes to update enabled state
    const unsubscribe = manager.subscribeToContext(() => {
      const enabled = manager.evaluateWhen(command.when);
      setIsEnabled(enabled);
    });

    // Initial enabled check
    setIsEnabled(manager.evaluateWhen(command.when));

    return () => {
      dispose();
      unsubscribe();
    };
  }, [command, manager]);

  // Execute command
  const execute = useCallback(
    async (args?: any) => {
      if (!isEnabled) {
        console.warn(`Command "${command.id}" is not enabled in current context`);
        return;
      }
      await manager.executeCommand(command.id, args);
    },
    [command.id, isEnabled, manager]
  );

  // Update keybinding
  const setKeybinding = useCallback(
    (key: string) => {
      manager.setKeybinding(command.id, { key });
      setKeybindingState(key);
    },
    [command.id, manager]
  );

  // Remove keybinding
  const removeKeybinding = useCallback(() => {
    manager.removeKeybinding(command.id);
    setKeybindingState(undefined);
  }, [command.id, manager]);

  return {
    execute,
    isEnabled,
    keybinding,
    setKeybinding,
    removeKeybinding,
  };
}

// Batch command registration
export function useCommands(commands: Command[]): Map<string, UseCommandResult> {
  const results = new Map<string, UseCommandResult>();

  commands.forEach(command => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = useCommand(command);
    results.set(command.id, result);
  });

  return results;
}