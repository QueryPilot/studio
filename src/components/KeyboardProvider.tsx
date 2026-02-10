import { logger } from "@/lib/logger";
import React, { type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';

import { contextKeyDefinitions } from '@/data/contextKeys';
import { appearanceCommands } from '@/data/commands/appearanceCommands';
import { queryCommands } from '@/data/commands/queryCommands';
import { defaultCommands } from '@/data/defaultCommands';
import { defaultKeybindings } from '@/data/defaultKeybindings';
import { keyboardHandler } from '@/services/keyboardHandler';
import { commandService } from '@/services/commandService';
import { contextService } from '@/services/contextService';
import { keybindingService } from '@/services/keybindingService';
import { userKeybindingsService } from '@/services/userKeybindingsService';
import { useWorkspaceScreenStore } from '@/stores/workspaceScreenStore';
import useWorkbenchStore from '@/stores/workbenchStore';
import { usePanelFocusStore } from '@/stores/panelFocusStore';
import { useModifierKey } from '@/hooks/useModifierKey';

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
    commandService.registerMany(appearanceCommands, 'default');
    commandService.registerMany(queryCommands, 'default');
  } catch (error) {
    logger.error('[KeyboardProvider] Failed to register default commands:', error);
  }

  try {
    keybindingService.registerMany(defaultKeybindings, 'default');
    userKeybindingsService.initialize();
  } catch (error) {
    logger.error('[KeyboardProvider] Failed to register default keybindings:', error);
  }

  servicesInitialized = true;
}

// Initialize services synchronously on module load
// This ensures commands are available before the first render
initializeServices();

export function KeyboardProvider({ children }: KeyboardProviderProps): React.JSX.Element {
  // Initialize modifier key tracking globally (called once for entire app)
  useModifierKey();

  useEffect(() => {
    // CRITICAL FIX: Set up context values BEFORE attaching keyboard listener
    // This prevents race condition where shortcuts with 'when' clauses fail
    // because context isn't ready yet when user presses a key

    const setSidebarContext = (sidebars: { left: boolean; right: boolean }) => {
      contextService.setValue('sideBarVisible', sidebars.left || sidebars.right);
      contextService.setValue('assistantVisible', sidebars.right);
    };

    setSidebarContext(useWorkspaceScreenStore.getState().getSidebars());

    // Subscribe to sidebar changes (using simple subscription that always fires)
    const unsubscribeSidebars = useWorkspaceScreenStore.subscribe((state) => {
      const sidebars = state.getSidebars();
      setSidebarContext(sidebars);
    });

    const setWorkbenchContext = (payload: { panelCount: number; focusedPanelId: string | null }) => {
      contextService.setValue('editorCount', payload.panelCount);
      contextService.setValue('hasMultipleEditors', payload.panelCount > 1);
      // activeEditor should be true if there's at least one panel, even if focusedPanelId is null
      const hasActiveEditor = payload.panelCount > 0 || Boolean(payload.focusedPanelId);
      contextService.setValue('activeEditor', hasActiveEditor);
    };

    const getWorkbenchPayload = () => ({
      panelCount: useWorkbenchStore.getState().panelContents.size,
      focusedPanelId: usePanelFocusStore.getState().focusedPanelId,
    });

    setWorkbenchContext(getWorkbenchPayload());

    // Subscribe to workbench store for panel count changes
    const unsubscribeWorkbench = useWorkbenchStore.subscribe((state) => {
      setWorkbenchContext({
        panelCount: state.panelContents.size,
        focusedPanelId: usePanelFocusStore.getState().focusedPanelId,
      });
    });

    // Subscribe to panel focus store for focus changes
    const unsubscribeFocus = usePanelFocusStore.subscribe((state) => {
      setWorkbenchContext({
        panelCount: useWorkbenchStore.getState().panelContents.size,
        focusedPanelId: state.focusedPanelId,
      });
    });

    // CRITICAL FIX: Re-sync context after subscription setup to catch any updates
    // that happened between initial read and subscription registration.
    // This fixes the race condition where workbench initializes before subscription is active.
    setWorkbenchContext(getWorkbenchPayload());

    // ADDITIONAL FIX: Poll for workbench initialization for a short period
    // This catches the case where WorkbenchLayout initializes after KeyboardProvider mounts
    let pollAttempts = 0;
    const maxPollAttempts = 10; // 10 attempts x 100ms = 1 second max
    const pollInterval = setInterval(() => {
      pollAttempts++;
      const panelCount = useWorkbenchStore.getState().panelContents.size;
      if (panelCount > 0 || pollAttempts >= maxPollAttempts) {
        // Workbench is initialized or we've waited long enough
        setWorkbenchContext(getWorkbenchPayload());
        clearInterval(pollInterval);
      }
    }, 100);

    // NOW attach keyboard listener - context is ready!
    keyboardHandler.initialize();

    return () => {
      keyboardHandler.dispose();
      unsubscribeSidebars();
      unsubscribeWorkbench();
      unsubscribeFocus();
      clearInterval(pollInterval); // Clean up polling interval
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
