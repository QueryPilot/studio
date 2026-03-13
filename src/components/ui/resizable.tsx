"use client";

import * as ResizablePrimitive from "react-resizable-panels";
import { useCallback } from "react";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  autoSaveId,
  defaultLayout,
  onLayoutChanged,
  ...props
}: ResizablePrimitive.GroupProps & {
  autoSaveId?: string;
}) {
  const persisted = ResizablePrimitive.useDefaultLayout({
    id: autoSaveId ?? "__noop__",
  });

  const handleLayoutChanged = useCallback(
    (layout: ResizablePrimitive.Layout) => {
      if (autoSaveId) {
        persisted.onLayoutChanged(layout);
      }
      onLayoutChanged?.(layout);
    },
    [autoSaveId, persisted, onLayoutChanged],
  );

  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className,
      )}
      defaultLayout={
        autoSaveId ? (persisted.defaultLayout ?? defaultLayout) : defaultLayout
      }
      onLayoutChanged={handleLayoutChanged}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "focus-visible:ring-ring relative flex w-1.5 items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        "cursor-col-resize aria-[orientation=horizontal]:cursor-row-resize focus-outline-transparent",
        className,
      )}
      {...props}
    >
      {withHandle && <div className="h-6 w-1 rounded-lg z-10 flex shrink-0" />}
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
