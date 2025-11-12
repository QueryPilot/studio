import React, { useCallback, useMemo } from "react";
import { type GridNode } from "@/types/workbench";
import { Panel } from "./PanelDnd";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/cn";
import { getAllPanels } from "@/utils/workbenchTree";

interface GridRendererProps {
  node: GridNode;
  path?: number[];
  className?: string;
}

export const GridRenderer: React.FC<GridRendererProps> = ({
  node,
  path = [],
  className,
}) => {
  const { resizePanelAction, focusedPanelId, layoutTree } = useWorkbenchStore();

  // Count total panels in the workbench
  const totalPanels = useMemo(() => {
    if (!layoutTree) return 0;
    return getAllPanels(layoutTree).length;
  }, [layoutTree]);

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (node.type === "branch" && sizes.length === 2) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const newRatio = sizes[0]! / 100;
        resizePanelAction(path, newRatio);
      }
    },
    [node.type, path, resizePanelAction],
  );

  if (node.type === "leaf") {
    if (!node.content) return null;
    return (
      <Panel
        content={node.content}
        path={path}
        className={cn(className, "rounded-xl overflow-hidden border-2", {
          "border-primary/30": totalPanels > 1 && node.id === focusedPanelId,
          "border-background": totalPanels <= 1 || node.id !== focusedPanelId,
        })}
      />
    );
  }

  if (node.children && node.children.length === 2) {
    const defaultSizes = [
      (node.splitRatio ?? 0.5) * 100,
      (1 - (node.splitRatio ?? 0.5)) * 100,
    ];

    return (
      <ResizablePanelGroup
        direction={node.orientation ?? "horizontal"}
        onLayout={handlePanelResize}
        className={className}
      >
        <ResizablePanel
          defaultSize={defaultSizes[0]}
          minSize={10}
          maxSize={90}
          className={cn("rounded-xl overflow-hidden bg-transparent", {
            "border border-primary/20": totalPanels > 1 && node.id === focusedPanelId,
          })}
        >
          {node.children[0] && (
            <GridRenderer node={node.children[0]} path={[...path, 0]} />
          )}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          defaultSize={defaultSizes[1]}
          minSize={10}
          maxSize={90}
          className={cn("rounded-xl overflow-hidden bg-transparent", {
            "border border-primary/20": totalPanels > 1 && node.id === focusedPanelId,
          })}
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
