import { useEffect, useMemo, useRef } from 'react';
import { v4 as uuid } from 'uuid';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { ContextValue } from '@/types/context';

interface UseContextKeyOptions {
  scopeId?: string;
  resetOnUnmount?: boolean;
}

export function useContextKey(
  key: string,
  value: ContextValue,
  options?: UseContextKeyOptions
): void {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  const previousValueRef = useRef<ContextValue | undefined>(undefined);

  const scopeChain = useMemo(() => (options?.scopeId ? [options.scopeId] : undefined), [options?.scopeId]);

  useEffect(() => {
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

export function useScopedKeybindings(explicitScopeId?: string): string {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  const scopeIdRef = useRef<string>(explicitScopeId ?? uuid());

  useEffect(() => {
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
