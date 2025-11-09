import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { tabGroupRegistry } from '@/services/tabGroupRegistry';

interface TabGroupContextValue {
  tabGroupId: string;
  isFocused: boolean;
  activeTabIndex: number;
  setActiveTabIndex: (index: number) => void;
  setFocused: (focused: boolean) => void;
  switchToTab: (index: number) => void;
  registerTab: (value: string) => void;
  tabValues: string[];
}

const TabGroupContext = createContext<TabGroupContextValue | null>(null);

interface TabGroupProviderProps {
  children: React.ReactNode;
  /**
   * Optional explicit ID for this tab group. If not provided, a UUID will be generated.
   */
  tabGroupId?: string;
  /**
   * Default active tab index
   */
  defaultValue?: string;
  /**
   * Controlled value for the active tab
   */
  value?: string;
  /**
   * Callback when the active tab changes
   */
  onValueChange?: (value: string) => void;
  /**
   * External focus control - when provided, overrides internal focus state
   * Use this to sync with panel/sheet/dialog focus
   */
  focused?: boolean;
}

export function TabGroupProvider({
  children,
  tabGroupId: explicitId,
  defaultValue,
  value,
  onValueChange,
  focused: externalFocused,
}: TabGroupProviderProps): React.JSX.Element {
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;

  // Generate stable ID for this tab group
  const tabGroupIdRef = useRef(explicitId ?? uuid());
  const tabGroupId = tabGroupIdRef.current;

  const [internalFocused, setInternalFocused] = useState(false);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [tabValues, setTabValues] = useState<string[]>([]);

  // Use external focus if provided, otherwise use internal state
  const isFocused = externalFocused !== undefined ? externalFocused : internalFocused;

  // Track if this tab group has ever been focused
  const hasBeenFocusedRef = useRef(false);

  // Reference to the active tab value for Radix Tabs integration
  const activeTabValueRef = useRef<string | undefined>(value ?? defaultValue);

  // Register with tab group registry
  useEffect(() => {
    const controller = {
      tabGroupId,
      switchToTab: (index: number) => {
        if (index >= 0 && index < tabValues.length) {
          const tabValue = tabValues[index];
          if (tabValue && onValueChange) {
            onValueChange(tabValue);
          }
        }
      },
      getTabCount: () => tabValues.length,
    };

    tabGroupRegistry.register(controller);

    return () => {
      tabGroupRegistry.unregister(tabGroupId);
    };
  }, [tabGroupId, tabValues, onValueChange]);

  // Update context service and registry when focus changes
  useEffect(() => {
    if (!contextService) {
      return;
    }

    if (isFocused) {
      hasBeenFocusedRef.current = true;
      contextService.setValue('focusedTabGroupId', tabGroupId);
      contextService.setValue('tabGroupFocused', true);
      tabGroupRegistry.setFocusedGroup(tabGroupId);
    } else if (hasBeenFocusedRef.current) {
      // Only clear if we were previously focused
      const currentFocusedId = contextService.getValue('focusedTabGroupId');
      if (currentFocusedId === tabGroupId) {
        contextService.setValue('focusedTabGroupId', null);
        contextService.setValue('tabGroupFocused', false);
      }
      tabGroupRegistry.clearFocusedGroup(tabGroupId);
    }
  }, [contextService, tabGroupId, isFocused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!contextService) {
        return;
      }

      // Clear focus if this tab group was focused
      const currentFocusedId = contextService.getValue('focusedTabGroupId');
      if (currentFocusedId === tabGroupId) {
        contextService.setValue('focusedTabGroupId', null);
        contextService.setValue('tabGroupFocused', false);
      }
    };
  }, [contextService, tabGroupId]);

  const setFocused = (focused: boolean) => {
    // Only update internal state if not externally controlled
    if (externalFocused === undefined) {
      setInternalFocused(focused);
    }
  };

  const switchToTab = (index: number) => {
    setActiveTabIndex(index);
    if (index >= 0 && index < tabValues.length) {
      const tabValue = tabValues[index];
      if (tabValue && onValueChange) {
        onValueChange(tabValue);
      }
    }
  };

  const registerTab = (tabValue: string) => {
    setTabValues((prev) => {
      if (!prev.includes(tabValue)) {
        return [...prev, tabValue];
      }
      return prev;
    });
  };

  const contextValue = useMemo<TabGroupContextValue>(
    () => ({
      tabGroupId,
      isFocused,
      activeTabIndex,
      setActiveTabIndex,
      setFocused,
      switchToTab,
      registerTab,
      tabValues,
    }),
    [tabGroupId, isFocused, activeTabIndex, tabValues]
  );

  return <TabGroupContext.Provider value={contextValue}>{children}</TabGroupContext.Provider>;
}

/**
 * Hook to access tab group context
 */
export function useTabGroup(): TabGroupContextValue | null {
  return useContext(TabGroupContext);
}

/**
 * Hook to access tab group context (throws if not within a TabGroupProvider)
 */
export function useTabGroupRequired(): TabGroupContextValue {
  const context = useContext(TabGroupContext);
  if (!context) {
    throw new Error('useTabGroupRequired must be used within a TabGroupProvider');
  }
  return context;
}
