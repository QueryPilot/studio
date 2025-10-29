import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
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

export function useSetContext(): (key: string, value: ContextValue, scopeId?: string) => void {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  return useCallback(
    (key: string, value: ContextValue, scopeId?: string) => {
      if (!contextService) {
        return;
      }
      contextService.setValue(key, value, scopeId);
    },
    [contextService]
  );
}

export function useContextValue<T = ContextValue>(key: string, defaultValue?: T): T {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;

  if (!contextService) {
    return (defaultValue as T | undefined) ?? (undefined as T);
  }

  return useSyncExternalStore(
    (listener) =>
      contextService.onDidChange((event) => {
        if (event.key === key) {
          listener();
        }
      }),
    () => {
      const value = contextService.getValue<T>(key);
      return (value ?? defaultValue) as T;
    },
    () => (defaultValue as T | undefined) ?? (undefined as T)
  );
}

export function useWhen(expression: string | undefined, scopes?: string[]): boolean {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;
  if (!contextService) {
    return false;
  }
  const expressionRef = useRef(expression);
  const scopesRef = useRef(scopes);

  expressionRef.current = expression;
  scopesRef.current = scopes;

  return useSyncExternalStore(
    (listener) => contextService.onDidChange(() => listener()),
    () => contextService.evaluate(expressionRef.current, { scopes: scopesRef.current }),
    () => contextService.evaluate(expressionRef.current, { scopes: scopesRef.current })
  );
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
