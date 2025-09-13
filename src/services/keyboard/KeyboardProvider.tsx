import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { KeyboardManager } from './KeyboardManager';
import type { KeyboardContext as KeyboardContextType, ViewContext } from './types';

interface KeyboardProviderProps {
  children: React.ReactNode;
  context?: ViewContext;
}

interface KeyboardContextValue {
  manager: KeyboardManager;
  context: KeyboardContextType;
  updateContext: (partial: Partial<KeyboardContextType>) => void;
  setActiveView: (view: ViewContext) => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

export function KeyboardProvider({ children, context: viewContext }: KeyboardProviderProps) {
  const [manager] = useState(() => KeyboardManager.getInstance());
  const [context, setContext] = useState<KeyboardContextType>(() => manager.getContext());

  // Initialize manager
  useEffect(() => {
    manager.initialize();

    // Subscribe to context changes
    const unsubscribe = manager.subscribeToContext(newContext => {
      setContext(newContext);
    });

    // Set initial view context if provided
    if (viewContext) {
      manager.updateContext({ activeView: viewContext });
    }

    return () => {
      unsubscribe();
      // Don't destroy manager here as it's a singleton
      // It should persist across component remounts
    };
  }, [manager, viewContext]);

  // Update context helper
  const updateContext = useCallback(
    (partial: Partial<KeyboardContextType>) => {
      manager.updateContext(partial);
    },
    [manager]
  );

  // Set active view helper
  const setActiveView = useCallback(
    (view: ViewContext) => {
      manager.updateContext({ activeView: view });
    },
    [manager]
  );

  const value: KeyboardContextValue = {
    manager,
    context,
    updateContext,
    setActiveView,
  };

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

// Hook to use keyboard context
export function useKeyboardContext(): KeyboardContextValue {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardContext must be used within KeyboardProvider');
  }
  return context;
}

// Component to provide local context
interface KeyboardScopeProps {
  children: React.ReactNode;
  context: ViewContext;
  when?: string;
}

export function KeyboardScope({ children, context: scopeContext, when }: KeyboardScopeProps) {
  const { manager } = useKeyboardContext();

  useEffect(() => {
    // Set context when this scope is mounted/focused
    const handleFocus = () => {
      if (!when || manager.evaluateWhen(when)) {
        manager.updateContext({ activeView: scopeContext });
      }
    };

    // Use focus within to detect when any child gets focus
    const element = document.getElementById(`keyboard-scope-${scopeContext}`);
    if (element) {
      element.addEventListener('focusin', handleFocus);
      return () => {
        element.removeEventListener('focusin', handleFocus);
      };
    }
    // Return empty cleanup function if element not found
    return () => {};
  }, [scopeContext, when, manager]);

  return (
    <div id={`keyboard-scope-${scopeContext}`} data-keyboard-context={scopeContext} className="h-full w-full">
      {children}
    </div>
  );
}