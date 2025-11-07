import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { type CommandHandler } from '@/types/command';
import { type KeybindingSource } from '@/types/keybinding';

interface UseCommandOptions {
  label: string;
  description?: string;
  category?: string;
  when?: string;
  enabledWhen?: string;
  metadata?: Record<string, unknown>;
  source?: KeybindingSource | 'system';
}

export function useCommand<TArgs = unknown>(
  commandId: string,
  handler: CommandHandler<TArgs>,
  options: UseCommandOptions
): void {
  const services = useKeyboardServicesOptional();
  const commandService = services?.commandService;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const commandDescriptor = useMemo(
    () => ({
      id: commandId,
      label: options.label,
      description: options.description,
      category: options.category,
      when: options.when,
      enabledWhen: options.enabledWhen,
      metadata: options.metadata,
    }),
    [
      commandId,
      options.category,
      options.description,
      options.enabledWhen,
      options.label,
      options.metadata,
      options.when,
    ]
  );

  useEffect(() => {
    if (!commandService) {
      return;
    }

    const source = options.source === 'system' ? 'system' : options.source ?? 'extension';

    try {
      commandService.register(
        {
          ...commandDescriptor,
          handler: (args, context) => handlerRef.current(args as TArgs, context),
        },
        (source === 'system' ? 'default' : source) as 'default' | 'system' | 'user'
      );
    } catch (error) {
      console.error(`[useCommand] Failed to register command ${commandId}`, error);
    }

    return () => {
      commandService.unregister(commandId);
    };
  }, [commandService, commandDescriptor, commandId, options.source]);
}

export function useExecuteCommand(): (commandId: string, args?: unknown) => Promise<void> {
  const services = useKeyboardServicesOptional();
  const commandService = services?.commandService;
  return useCallback(
    async (commandId: string, args?: unknown) => {
      if (!commandService) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[useExecuteCommand] Command service unavailable; skipping ${commandId}`);
        }
        return;
      }
      await commandService.execute(commandId, args);
    },
    [commandService]
  );
}
