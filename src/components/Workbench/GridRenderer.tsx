import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { type GridNode } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/cn";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";
import { PanelContainer } from "./PanelPortalContext";

interface GridRendererProps {
  node: GridNode;
  path?: number[];
  className?: string;
}

const PRIMARY_ID = "primary";
const SECONDARY_ID = "secondary";

export const GridRenderer: React.FC<GridRendererProps> = ({
  node,
  path = [],
  className,
}) => {
  const resizePanelAction = useWorkbenchStore((s) => s.resizePanelAction);
  const panelGroupRef = useRef<GroupImperativeHandle | null>(null);
  const isSyncingRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);

  // Cancel pending RAF on unmount to prevent stale store updates
  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  const handlePanelResize = useCallback(
    (layout: Layout) => {
      const sizes = Object.values(layout);
      if (
        node.type === "branch" &&
        sizes.length === 2 &&
        !isSyncingRef.current
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const newRatio = sizes[0]! / 100;
        // RAF-debounce the store update to avoid re-renders during drag
        if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          resizePanelAction(path, newRatio);
        });
      }
    },
    [node.type, path, resizePanelAction],
  );

  useLayoutEffect(() => {
    if (node.type !== "branch") return;
    const ref = panelGroupRef.current;
    if (!ref) return;
    const ratio = node.splitRatio ?? 0.5;
    const desiredPrimary = ratio * 100;
    const desiredSecondary = 100 - desiredPrimary;
    const layout = ref.getLayout();
    const primary = layout[PRIMARY_ID];
    const secondary = layout[SECONDARY_ID];
    if (primary === undefined || secondary === undefined) return;
    const delta =
      Math.abs(primary - desiredPrimary) +
      Math.abs(secondary - desiredSecondary);
    if (delta > 0.1) {
      isSyncingRef.current = true;
      ref.setLayout({ [PRIMARY_ID]: desiredPrimary, [SECONDARY_ID]: desiredSecondary });
      if (typeof window !== "undefined") {
        const frame = window.requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
        return () => {
          window.cancelAnimationFrame(frame);
        };
      }
      isSyncingRef.current = false;
    }
    return undefined;
  }, [node.type, node.splitRatio]);

  if (node.type === "leaf") {
    return (
      <PanelContainer
        panelId={node.id}
        className={cn(className, "h-full")}
      />
    );
  }

  if (node.children && node.children.length === 2) {
    const splitRatio = node.splitRatio ?? 0.5;
    const primaryPct = `${splitRatio * 100}`;
    const secondaryPct = `${(1 - splitRatio) * 100}`;

    return (
      <ResizablePanelGroup
        groupRef={panelGroupRef}
        orientation={node.orientation ?? "horizontal"}
        onLayoutChanged={handlePanelResize}
        className={className}
      >
        <ResizablePanel
          id={PRIMARY_ID}
          defaultSize={primaryPct}
          minSize="10"
          maxSize="90"
          className="rounded-xl overflow-hidden bg-transparent"
        >
          {node.children[0] && (
            <GridRenderer node={node.children[0]} path={[...path, 0]} />
          )}
        </ResizablePanel>
        <ResizableHandle
          style={{ cursor: node.orientation === "vertical" ? "row-resize" : "col-resize" }}
        />
        <ResizablePanel
          id={SECONDARY_ID}
          defaultSize={secondaryPct}
          minSize="10"
          maxSize="90"
          className="rounded-xl overflow-hidden bg-transparent"
        >
          {node.children[1] && (
            <GridRenderer node={node.children[1]} path={[...path, 1]} />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return null;
};
