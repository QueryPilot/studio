import { memo } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ArrowRight, ArrowLeft, SplitSquareHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePanelStore } from "@/stores/panelStore";
import type { TabState } from "@/types/workspaceScreen";

interface TabContextMenuProps {
  children: React.ReactNode;
  tab: TabState;
  className?: string;
}

export const TabContextMenu = memo(function TabContextMenu({
  children,
  tab,
  className,
}: TabContextMenuProps) {
  const {
    panels,
    // splitMode,
    createPanel,
    setSplitMode,
    moveTabBetweenPanels,
    removeTabFromPanel,
  } = usePanelStore();

  const panelsArray = Array.from(panels.values());
  const currentPanel = panelsArray.find((panel) => panel.tabs.has(tab.id));
  // const otherPanels = panelsArray.filter(panel => !panel.tabs.has(tab.id));
  const hasSecondaryPanel = panelsArray.some(
    (panel) => panel.type === "secondary",
  );
  const isInPrimaryPanel = currentPanel?.type === "primary";
  const isInSecondaryPanel = currentPanel?.type === "secondary";

  const handleMoveToPanel = (targetPanelId: string) => {
    if (currentPanel) {
      moveTabBetweenPanels(tab.id, currentPanel.id, targetPanelId);
    }
  };

  const handleMoveToNewPanel = () => {
    if (currentPanel) {
      const newPanelId = createPanel("secondary");
      setSplitMode("horizontal");
      moveTabBetweenPanels(tab.id, currentPanel.id, newPanelId);
    }
  };

  const handleCloseTab = () => {
    if (currentPanel) {
      removeTabFromPanel(currentPanel.id, tab.id);
    }
  };

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <div className={className}>{children}</div>
      </ContextMenuPrimitive.Trigger>

      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "z-50 min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2",
            "data-[side=left]:slide-in-from-right-2",
            "data-[side=right]:slide-in-from-left-2",
            "data-[side=top]:slide-in-from-bottom-2",
          )}
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Tab: {tab.title}
          </div>
          <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />

          {/* Move to other panel (only show if not already in that panel type) */}
          {isInPrimaryPanel && hasSecondaryPanel && (
            <ContextMenuPrimitive.Item
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                "hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => {
                const secondaryPanel = panelsArray.find(
                  (p) => p.type === "secondary",
                );
                if (secondaryPanel) handleMoveToPanel(secondaryPanel.id);
              }}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>Move to secondary panel</span>
            </ContextMenuPrimitive.Item>
          )}

          {isInSecondaryPanel && (
            <ContextMenuPrimitive.Item
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                "hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => {
                const primaryPanel = panelsArray.find(
                  (p) => p.type === "primary",
                );
                if (primaryPanel) handleMoveToPanel(primaryPanel.id);
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Move to primary panel</span>
            </ContextMenuPrimitive.Item>
          )}

          {/* Create new split panel - only show if no secondary panel exists */}
          {!hasSecondaryPanel && isInPrimaryPanel && (
            <ContextMenuPrimitive.Item
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                "hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={handleMoveToNewPanel}
            >
              <SplitSquareHorizontal className="h-3.5 w-3.5" />
              <span>Move to new split panel</span>
            </ContextMenuPrimitive.Item>
          )}

          <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />

          {/* Close tab */}
          <ContextMenuPrimitive.Item
            className={cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
              "hover:bg-destructive hover:text-destructive-foreground",
            )}
            onClick={handleCloseTab}
          >
            <X className="h-3.5 w-3.5" />
            <span>Close tab</span>
            <span className="ml-auto text-xs opacity-60">⌘W</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
});
