import React, { useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import { GridRenderer } from "./GridRenderer";
import { Panel } from "./PanelDnd";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useShallow } from "zustand/react/shallow";
import { PanelPortalProvider, PanelPortal } from "./PanelPortalContext";

/**
 * Memoized panel portals — prevents re-rendering all panels when layoutTree changes during resize.
 * panelIds from useShallow is reference-stable when panels don't change,
 * so this component skips re-renders entirely during resize drag.
 */
const PanelPortals = memo(function PanelPortals({ panelIds }: { panelIds: string[] }) {
  return (
    <>
      {panelIds.map((panelId) => (
        <PanelPortal key={panelId} panelId={panelId}>
          <Panel
            panelId={panelId}
            className="h-full rounded-xl overflow-hidden"
          />
        </PanelPortal>
      ))}
    </>
  );
});

interface WorkbenchLayoutProps {
  className?: string;
  connectionId?: string;
  database?: string;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  className,
  connectionId,
}) => {
  // Use granular selectors to avoid re-rendering when unrelated store fields change
  const layoutTree = useWorkbenchStore((s) => s.layoutTree);
  const setConnectionId = useWorkbenchStore((s) => s.setConnectionId);
  const initializeLayout = useWorkbenchStore((s) => s.initializeLayout);
  // Get stable list of panel IDs - useShallow does shallow array comparison
  // so this only re-renders when panels are added/removed, not when tab content changes
  const panelIds = useWorkbenchStore(
    useShallow((s) => Array.from(s.panelContents.keys())),
  );

  // Set connection ID when component mounts or connection changes
  useEffect(() => {
    if (connectionId) {
      setConnectionId(connectionId);
    }
  }, [connectionId, setConnectionId]);

  useEffect(() => {
    if (!layoutTree) {
      initializeLayout();
    }
  }, [layoutTree, initializeLayout]);

  if (!layoutTree) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-muted-foreground">Initializing workbench...</div>
      </div>
    );
  }

  return (
    <PanelPortalProvider>
      <div
        className={cn("workbench-layout h-full overflow-hidden", className)}
      >
        <GridRenderer node={layoutTree} className="h-full" />
      </div>

      {/* Panel portals memoized separately — immune to layoutTree changes during resize */}
      <PanelPortals panelIds={panelIds} />
    </PanelPortalProvider>
  );
};
