import { useEffect, useMemo } from 'react';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { Keybinding, KeybindingSource } from '@/types/keybinding';

interface UseKeybindingOptions {
  when?: string;
  args?: unknown;
  weight?: number;
  source?: KeybindingSource;
}

export function useKeybinding(command: string, key: string, options?: UseKeybindingOptions): void {
  useKeybindings([
    {
      command,
      key,
      when: options?.when,
      args: options?.args,
      weight: options?.weight,
      source: options?.source,
    },
  ]);
}

export function useKeybindings(bindings: Keybinding[]): void {
  const services = useKeyboardServicesOptional();
  const keybindingService = services?.keybindingService;

  const entries = useMemo(
    () =>
      bindings.map((binding) => ({
        ...binding,
        source: binding.source ?? 'extension',
      })),
    [bindings]
  );

  useEffect(() => {
    if (!keybindingService) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useKeybindings] Keybinding service unavailable; bindings skipped', entries);
      }
      return;
    }

    for (const binding of entries) {
      try {
        keybindingService.register(binding, binding.source ?? 'extension');
      } catch (error) {
        console.error('[useKeybindings] Failed to register keybinding', binding, error);
      }
    }

    return () => {
      keybindingService.unregister((existing) =>
        entries.some(
          (binding) =>
            binding.command === existing.command &&
            binding.key === existing.key &&
            (binding.when ?? '') === (existing.when ?? '')
        )
      );
    };
  }, [entries, keybindingService]);
}
