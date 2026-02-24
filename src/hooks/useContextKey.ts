import { useLayoutEffect, useMemo, useRef } from 'react';
import { v4 as uuid } from 'uuid';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { type ContextValue } from '@/types/context';

interface UseContextKeyOptions {
  scopeId?: string;
  resetOnUnmount?: boolean;
}

/**
 * Hook to set a context key value, used for evaluating keybinding `when` conditions.
 *
 * IMPORTANT: Uses useLayoutEffect to update context synchronously after DOM mutations.
 * This ensures keyboard event handlers see the correct context values immediately,
 * preventing race conditions where shortcuts fire before context is updated
 * (e.g., Cmd+Z firing before editingCell is set to true).
 */
export function useContextKey(
  key: string,
  value: ContextValue,
  options?: UseContextKeyOptions
): void {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  const previousValueRef = useRef<ContextValue | undefined>(undefined);

  const scopeChain = useMemo(() => (options?.scopeId ? [options.scopeId] : undefined), [options?.scopeId]);

  // useLayoutEffect ensures context is updated synchronously after DOM mutations,
  // before any keyboard events can fire. This prevents race conditions where
  // keybindings are evaluated against stale context values.
  useLayoutEffect(() => {
    if (!contextService) {
      return;
    }

    previousValueRef.current = contextService.getValue(key, scopeChain);
    contextService.setValue(key, value, options?.scopeId);

    return () => {
      if (options?.resetOnUnmount === false) {
        return;
      }

      const previous = previousValueRef.current;
      if (options?.scopeId) {
        if (previous === undefined) {
          contextService.setValue(key, undefined, options.scopeId);
        } else {
          contextService.setValue(key, previous, options.scopeId);
        }
      } else if (previous === undefined) {
        contextService.reset(key);
      } else {
        contextService.setValue(key, previous);
      }
    };
  }, [contextService, key, options?.scopeId, options?.resetOnUnmount, scopeChain, value]);
}

/**
 * Hook to create and manage a scoped keybinding context.
 *
 * IMPORTANT: Uses useLayoutEffect to enter scope synchronously, ensuring
 * the scope is active before any keyboard events can fire.
 */
export function useScopedKeybindings(explicitScopeId?: string): string {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  const scopeIdRef = useRef<string>(explicitScopeId ?? uuid());

  // useLayoutEffect ensures scope is entered synchronously after DOM mutations
  useLayoutEffect(() => {
    if (!contextService) {
      return;
    }
    contextService.enterScope(scopeIdRef.current);
    return () => {
      contextService.exitScope(scopeIdRef.current);
      contextService.disposeScope(scopeIdRef.current);
    };
  }, [contextService]);

  return scopeIdRef.current;
}
