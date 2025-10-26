/**
 * Pending Edits Indicator
 *
 * Badge showing pending changes count in the workspace title bar.
 */

import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Circle, AlertTriangle } from "lucide-react";
import {
  usePendingChangesCount,
  useConnectionEditSummary,
} from "@/stores/tableEditStore.selectors";
import { PendingEditsDrawer } from "../PendingEditsDrawer/PendingEditsDrawer";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface PendingEditsIndicatorProps {
  connectionId: string;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const PendingEditsIndicator = memo(function PendingEditsIndicator({
  connectionId,
  className,
}: PendingEditsIndicatorProps) {
  const count = usePendingChangesCount(connectionId);
  const summary = useConnectionEditSummary(connectionId);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleClick = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  // Don't render if no changes
  if (count === 0) {
    return null;
  }

  // Check if there are destructive changes
  const hasDestructiveChanges = Array.from(summary.byScope.values()).some(
    (scope) => scope.hasDestructiveChanges,
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        className={cn("gap-2 h-8 px-3", className)}
        title={`${count} pending change${count !== 1 ? "s" : ""}`}
      >
        <div className="relative flex items-center justify-center">
          {/* Ping animation background */}
          <span
            className={cn(
              "absolute inline-flex h-2.5 w-2.5 rounded-full opacity-75 animate-ping",
              hasDestructiveChanges ? "bg-destructive" : "bg-primary",
            )}
          />
          {/* Icon */}
          {hasDestructiveChanges ? (
            <AlertTriangle className="relative !h-2 !w-2 text-destructive" />
          ) : (
            <Circle className="relative !h-2 !w-2 text-primary fill-primary" />
          )}
        </div>
        <span className="text-xs font-medium">
          {count} edit{count !== 1 ? "s" : ""}
        </span>
      </Button>

      <PendingEditsDrawer
        connectionId={connectionId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
});

// ============================================================================
// Hook for programmatic control
// ============================================================================

/**
 * Hook to control the pending edits drawer
 */
export function usePendingEditsDrawer() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
  };
}

// ============================================================================
// Keyboard shortcut hook
// ============================================================================

import { useEffect } from "react";

/**
 * Hook to bind keyboard shortcut for opening the drawer
 */
export function usePendingEditsShortcut(callback: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+P or Cmd+Shift+P
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "p") {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [callback]);
}
