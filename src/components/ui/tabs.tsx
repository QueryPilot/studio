import { logger } from "@/lib/logger";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/cn";
import { TabGroupProvider, useTabGroup } from "./TabGroupProvider";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { KeyboardShortcut } from "./keyboard-shortcut";

interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  /**
   * Enable keyboard shortcut display (Cmd/Ctrl + number)
   */
  enableShortcuts?: boolean;
  /**
   * Optional explicit ID for this tab group
   */
  tabGroupId?: string;
  /**
   * External focus control - when true, this tab group is focused
   * Use this to sync with panel/sheet/dialog focus state
   */
  focused?: boolean;
  /**
   * Enable global keyboard shortcuts (Cmd+1, Cmd+2, etc.) for this tab group
   * CRITICAL: Only ONE tab group per panel should have this enabled
   * to avoid race conditions when multiple tab groups exist
   * Requires enableShortcuts to be true
   * Default: true (when enableShortcuts is true)
   */
  enableGlobalShortcuts?: boolean;
}

const Tabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  TabsProps
>(
  (
    {
      enableShortcuts = false,
      tabGroupId,
      focused,
      enableGlobalShortcuts = true,
      children,
      ...props
    },
    ref,
  ) => {
    if (!enableShortcuts) {
      // If shortcuts are disabled, render without TabGroupProvider
      return (
        <TabsPrimitive.Root ref={ref} activationMode="manual" {...props}>
          {children}
        </TabsPrimitive.Root>
      );
    }

    // Wrap with TabGroupProvider when shortcuts are enabled
    return (
      <TabGroupProvider
        tabGroupId={tabGroupId}
        defaultValue={props.defaultValue}
        value={props.value}
        onValueChange={props.onValueChange}
        focused={focused}
        enableGlobalShortcuts={enableGlobalShortcuts}
      >
        <TabsPrimitive.Root ref={ref} activationMode="manual" {...props}>
          {children}
        </TabsPrimitive.Root>
      </TabGroupProvider>
    );
  },
);
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const tabGroup = useTabGroup();

  // Handle clicks - this DOES bubble unlike focus events
  const handleClick = () => {
    if (tabGroup) {
      logger.info("[TabsList] Click - setting focused:", tabGroup.tabGroupId);
      tabGroup.setFocused(true);
    }
  };

  // Use capture phase to catch focus events before they reach children
  const handleFocusCapture = () => {
    if (tabGroup) {
      logger.info(
        "[TabsList] Focus capture - setting focused:",
        tabGroup.tabGroupId,
      );
      tabGroup.setFocused(true);
    }
  };

  // REMOVED: Aggressive blur handler that was unfocusing when clicking grid cells
  // Focus should be managed at the Panel/Sheet level, not the TabsList level

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-muted p-1 text-muted-foreground",
        className,
      )}
      onClick={handleClick}
      onFocusCapture={handleFocusCapture}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /**
   * The index of this tab (0-based). Used for keyboard shortcuts.
   */
  tabIndex?: number;
  /**
   * Override to hide shortcut for this specific tab
   */
  hideShortcut?: boolean;
}

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(
  (
    { className, children, tabIndex, hideShortcut = false, value, ...props },
    ref,
  ) => {
    const tabGroup = useTabGroup();
    const keyboardServices = useKeyboardServicesOptional();

    // Track modifier key state with local state
    const [isModifierHeld, setIsModifierHeld] = React.useState(false);

    // Subscribe to modifier key changes from context
    React.useEffect(() => {
      if (!keyboardServices?.contextService) {
        logger.info("[TabsTrigger] No contextService available");
        return;
      }

      const checkModifierState = () => {
        const value =
          keyboardServices.contextService.getValue("modifierKeyHeld");
        const newValue = Boolean(value);
        if (newValue !== isModifierHeld) {
          logger.info("[TabsTrigger] Modifier key changed:", {
            value,
            newValue,
            tabIndex,
            tabValue: value,
            groupFocused: tabGroup?.isFocused,
          });
        }
        setIsModifierHeld(newValue);
      };

      // Check initial state
      checkModifierState();

      // Poll for changes (60fps) - context service doesn't have event emitter
      const interval = setInterval(checkModifierState, 16);

      return () => {
        clearInterval(interval);
      };
    }, [keyboardServices, isModifierHeld, tabIndex, tabGroup]);

    // Register this tab value with the group
    React.useEffect(() => {
      if (tabGroup && value) {
        tabGroup.registerTab(value);
      }
    }, [tabGroup, value]);

    // Only show shortcut if:
    // 1. TabGroup is available (shortcuts enabled)
    // 2. This tab group is focused
    // 3. Modifier key is held
    // 4. Tab index is valid (0-8, corresponding to shortcuts 1-9)
    // 5. Not explicitly hidden
    const shouldShowShortcut =
      tabGroup &&
      tabGroup.isFocused &&
      isModifierHeld &&
      tabIndex !== undefined &&
      tabIndex >= 0 &&
      tabIndex <= 8 &&
      !hideShortcut;

    // Debug logging for shortcut display
    React.useEffect(() => {
      if (isModifierHeld && tabIndex !== undefined && tabIndex <= 8) {
        logger.info("[TabsTrigger] Shortcut check:", {
          tabIndex,
          value,
          hasTabGroup: !!tabGroup,
          isFocused: tabGroup?.isFocused,
          isModifierHeld,
          shouldShow: shouldShowShortcut,
          hideShortcut,
        });
      }
    }, [
      isModifierHeld,
      tabIndex,
      value,
      tabGroup,
      shouldShowShortcut,
      hideShortcut,
    ]);

    const shortcutNumber = tabIndex !== undefined ? tabIndex + 1 : undefined;

    return (
      <TabsPrimitive.Trigger
        ref={ref}
        value={value}
        className={cn(
          "relative inline-flex items-center justify-center whitespace-nowrap rounded-xl px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
          shouldShowShortcut && "gap-2",
          className,
        )}
        {...props}
      >
        <span className="flex items-center gap-1.5">{children}</span>
        {shouldShowShortcut && shortcutNumber && (
          <div className="absolute right-0">
            <KeyboardShortcut
              keys={[shortcutNumber.toString()]}
              variant="ghost"
              className="ml-auto opacity-70 transition-opacity"
            />
          </div>
        )}
      </TabsPrimitive.Trigger>
    );
  },
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
