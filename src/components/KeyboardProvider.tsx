import { ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { shallow } from 'zustand/shallow';

import { contextKeyDefinitions } from '@/data/contextKeys';
import { defaultCommands } from '@/data/defaultCommands';
import { defaultKeybindings } from '@/data/defaultKeybindings';
import { keyboardHandler } from '@/services/keyboardHandler';
import { commandService } from '@/services/commandService';
import { contextService } from '@/services/contextService';
import { keybindingService } from '@/services/keybindingService';
import { useWorkspaceScreenStore } from '@/stores/workspaceScreenStore';
import useWorkbenchStore from '@/stores/workbenchStore';

interface KeyboardProviderProps {
  children: ReactNode;
}

interface KeyboardServicesValue {
  commandService: typeof commandService;
  keybindingService: typeof keybindingService;
  contextService: typeof contextService;
}

const KeyboardServicesContext = createContext<KeyboardServicesValue | null>(null);

let servicesInitialized = false;

function initializeServices(): void {
  if (servicesInitialized) {
    return;
  }

  contextService.defineMany(contextKeyDefinitions);

  try {
    commandService.registerMany(defaultCommands, 'default');
  } catch (error) {
    console.error('[KeyboardProvider] Failed to register default commands:', error);
  }

  try {
    keybindingService.registerMany(defaultKeybindings, 'default');
  } catch (error) {
    console.error('[KeyboardProvider] Failed to register default keybindings:', error);
  }

  servicesInitialized = true;
}

export function KeyboardProvider({ children }: KeyboardProviderProps): JSX.Element {
  useEffect(() => {
    // Initialize services (commands and keybindings)
    initializeServices();

    // CRITICAL FIX: Set up context values BEFORE attaching keyboard listener
    // This prevents race condition where shortcuts with 'when' clauses fail
    // because context isn't ready yet when user presses a key

    const setSidebarContext = (sidebars: { left: boolean; right: boolean }) => {
      contextService.setValue('sideBarVisible', sidebars.left || sidebars.right);
      contextService.setValue('assistantVisible', sidebars.right);
    };

    setSidebarContext(useWorkspaceScreenStore.getState().getSidebars());

    const unsubscribeSidebars = useWorkspaceScreenStore.subscribe(
      (state) => state.getSidebars(),
      setSidebarContext,
      {
        equalityFn: (left, right) => left.left === right.left && left.right === right.right,
      }
    );

    const setWorkbenchContext = (payload: { panelCount: number; focusedPanelId: string | null }) => {
      contextService.setValue('editorCount', payload.panelCount);
      contextService.setValue('hasMultipleEditors', payload.panelCount > 1);
      // activeEditor should be true if there's at least one panel, even if focusedPanelId is null
      const hasActiveEditor = payload.panelCount > 0 || Boolean(payload.focusedPanelId);
      contextService.setValue('activeEditor', hasActiveEditor);
    };

    const initialWorkbenchState = useWorkbenchStore.getState();
    setWorkbenchContext({
      panelCount: initialWorkbenchState.panelContents.size,
      focusedPanelId: initialWorkbenchState.focusedPanelId,
    });

    const unsubscribeWorkbench = useWorkbenchStore.subscribe(
      (state) => ({
        panelCount: state.panelContents.size,
        focusedPanelId: state.focusedPanelId,
      }),
      setWorkbenchContext,
      {
        equalityFn: shallow,
      }
    );

    // NOW attach keyboard listener - context is ready!
    keyboardHandler.initialize();

    return () => {
      keyboardHandler.dispose();
      unsubscribeSidebars();
      unsubscribeWorkbench();
    };
  }, []);

  const value = useMemo<KeyboardServicesValue>(
    () => ({
      commandService,
      keybindingService,
      contextService,
    }),
    []
  );

  return (
    <KeyboardServicesContext.Provider value={value}>
      {children}
    </KeyboardServicesContext.Provider>
  );
}

export function useKeyboardServicesOptional(): KeyboardServicesValue | null {
  return useContext(KeyboardServicesContext);
}

export function useKeyboardServices(): KeyboardServicesValue {
  const services = useKeyboardServicesOptional();
  if (!services) {
    throw new Error('useKeyboardServices must be used within a KeyboardProvider');
  }
  return services;
}
