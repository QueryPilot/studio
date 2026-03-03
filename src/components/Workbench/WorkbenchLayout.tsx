import React, { useEffect, memo, useRef } from "react";
import { cn } from "@/lib/utils";
import { GridRenderer } from "./GridRenderer";
import { Panel } from "./PanelDnd";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useShallow } from "zustand/react/shallow";
import { PanelPortalProvider, PanelPortal } from "./PanelPortalContext";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { saveWindowBounds } from "@/services/windowManager";
import { isTauri } from "@/utils/tauri";

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
  const persistLayout = useWorkbenchStore((s) => s.persistLayout);
  const loadLayout = useWorkbenchStore((s) => s.loadLayout);
  const flushLayout = useWorkbenchStore((s) => s.flushLayout);
  const panelContents = useWorkbenchStore((s) => s.panelContents);
  const activeWorkspaceId = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.id ?? null,
  );
  const initializedScopeRef = useRef<string | null>(null);
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScopeRef = useRef<string | null>(null);
  const hasLayoutRef = useRef(false);
  const layoutScopeId = activeWorkspaceId ?? connectionId ?? null;
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
    if (!layoutScopeId) {
      if (!layoutTree) {
        initializeLayout();
      }
      return;
    }

    if (initializedScopeRef.current === layoutScopeId) return;

    initializedScopeRef.current = layoutScopeId;

    // Async load from IndexedDB
    loadLayout(layoutScopeId).then((restored) => {
      if (!restored) {
        initializeLayout();
      }
    });
  }, [layoutScopeId, loadLayout, initializeLayout]);

  useEffect(() => {
    if (!layoutScopeId || !layoutTree) return;

    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }

    saveDebounceTimerRef.current = setTimeout(() => {
      persistLayout(layoutScopeId);
    }, 500);

    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
    };
  }, [layoutScopeId, layoutTree, panelContents, persistLayout]);

  useEffect(() => {
    latestScopeRef.current = layoutScopeId;
    hasLayoutRef.current = !!layoutTree;
  }, [layoutScopeId, layoutTree]);

  useEffect(() => {
    return () => {
      const scopeId = latestScopeRef.current;
      if (scopeId && hasLayoutRef.current) {
        flushLayout(scopeId);
      }
    };
  }, [flushLayout]);

  // Track window bounds on move/resize for session restore
  useEffect(() => {
    if (!layoutScopeId || !isTauri()) return;

    let boundsTimer: ReturnType<typeof setTimeout> | null = null;
    const unlistenPromises: Promise<() => void>[] = [];

    const persistBounds = () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const position = await win.outerPosition();
          const size = await win.outerSize();
          await saveWindowBounds(layoutScopeId, {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          });
        } catch {
          // Window may already be closing; ignore
        }
      }, 500);
    };

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlistenPromises.push(win.onMoved(persistBounds));
        unlistenPromises.push(win.onResized(persistBounds));
      } catch {
        // Not in a Tauri window context; ignore
      }
    })();

    return () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      void Promise.all(unlistenPromises).then((cleanups) => {
        for (const fn of cleanups) fn();
      });
    };
  }, [layoutScopeId]);

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
