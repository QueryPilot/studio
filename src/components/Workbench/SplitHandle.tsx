import React, { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type Orientation } from "@/types/workbench";

interface SplitHandleProps {
  orientation: Orientation;
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
}

export const SplitHandle: React.FC<SplitHandleProps> = ({
  orientation,
  onResize,
  onResizeEnd,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const currentPos = orientation === "horizontal" ? e.clientX : e.clientY;
      onResize(currentPos);
    },
    [isDragging, orientation, onResize],
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      onResizeEnd?.();
    }
  }, [isDragging, onResizeEnd]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor =
        orientation === "horizontal" ? "col-resize" : "row-resize";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
      };
    }
    return undefined;
  }, [isDragging, handleMouseMove, handleMouseUp, orientation]);

  const handleDoubleClick = useCallback(() => {
    onResize(0);
    onResizeEnd?.();
  }, [onResize, onResizeEnd]);

  return (
    <div
      className={cn(
        "split-handle group relative flex items-center justify-center transition-all bg-border/30 hover:bg-primary/10 z-10",
        orientation === "horizontal"
          ? "min-w-2 h-full cursor-col-resize"
          : "min-h-2 w-full cursor-row-resize",
        isDragging && "bg-primary/10",
        className,
      )}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className={cn(
          "absolute bg-muted-foreground/30 group-hover:bg-primary/50 transition-all rounded-full",
          orientation === "horizontal"
            ? "h-8 w-0.5 group-hover:w-1"
            : "w-8 h-0.5 group-hover:h-1",
          isDragging && "bg-primary",
        )}
      />
    </div>
  );
};
