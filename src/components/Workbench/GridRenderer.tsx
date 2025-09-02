import React, { useCallback, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type GridNode } from "@/types/workbench";
import { Panel } from "./PanelDnd";
import { SplitHandle } from "./SplitHandle";
import useWorkbenchStore from "@/stores/workbenchStore";

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
  const { resizePanelAction } = useWorkbenchStore();
  const containerRef = useRef<HTMLDivElement>(null);
  // const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [localSplitRatio, setLocalSplitRatio] = useState(
    node.splitRatio || 0.5,
  );

  useEffect(() => {
    setLocalSplitRatio(node.splitRatio || 0.5);
  }, [node.splitRatio]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        // const rect = containerRef.current.getBoundingClientRect();
        // setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleResize = useCallback(
    (mousePos: number) => {
      if (!containerRef.current || node.type !== "branch") return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerStart =
        node.orientation === "horizontal"
          ? containerRect.left
          : containerRect.top;
      const totalSize =
        node.orientation === "horizontal"
          ? containerRect.width
          : containerRect.height;

      const relativePos = mousePos - containerStart;
      const newRatio = Math.max(0.1, Math.min(0.9, relativePos / totalSize));

      setLocalSplitRatio(newRatio);
    },
    [node],
  );

  const handleResizeEnd = useCallback(() => {
    if (node.type === "branch") {
      resizePanelAction(path, localSplitRatio);
    }
  }, [node.type, path, localSplitRatio, resizePanelAction]);

  if (node.type === "leaf") {
    return <Panel content={node.content!} path={path} className={className} />;
  }

  if (node.type === "branch" && node.children && node.children.length === 2) {
    const isHorizontal = node.orientation === "horizontal";
    const firstSize = `${localSplitRatio * 100}%`;
    const secondSize = `${(1 - localSplitRatio) * 100}%`;

    return (
      <div
        ref={containerRef}
        className={cn(
          "flex h-full w-full",
          isHorizontal ? "flex-row" : "flex-col",
          className,
        )}
      >
        <div
          style={{
            [isHorizontal ? "width" : "height"]: firstSize,
            minWidth: isHorizontal ? "100px" : undefined,
            minHeight: !isHorizontal ? "100px" : undefined,
            flex: isHorizontal ? `0 0 ${firstSize}` : `0 0 ${firstSize}`,
          }}
          className="overflow-hidden"
        >
          {node.children[0] && (
            <GridRenderer node={node.children[0]} path={[...path, 0]} />
          )}
        </div>

        <SplitHandle
          orientation={node.orientation!}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />

        <div
          style={{
            [isHorizontal ? "width" : "height"]: secondSize,
            minWidth: isHorizontal ? "100px" : undefined,
            minHeight: !isHorizontal ? "100px" : undefined,
            flex: isHorizontal ? `0 0 ${secondSize}` : `0 0 ${secondSize}`,
          }}
          className="overflow-hidden"
        >
          {node.children[1] && (
            <GridRenderer node={node.children[1]} path={[...path, 1]} />
          )}
        </div>
      </div>
    );
  }

  return null;
};
