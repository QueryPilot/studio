import { Panel as PanelComponent } from "./Panel";
import { usePanelStore } from "@/stores/panelStore";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useDroppable } from "@dnd-kit/core";

interface SplitPanelContainerProps {
  connectionId: string;
}

export function SplitPanelContainer({ connectionId }: SplitPanelContainerProps) {
  const { panels, splitMode } = usePanelStore();
  
  // Get primary and secondary panels
  const primaryPanel = Array.from(panels.values()).find(p => p.type === "primary");
  const secondaryPanel = Array.from(panels.values()).find(p => p.type === "secondary");

  // Create drop zone for secondary panel if it doesn't exist
  const { setNodeRef: setDropZoneRef } = useDroppable({
    id: 'secondary-panel-drop-zone',
    data: {
      panelId: secondaryPanel?.id || 'new-secondary',
      type: 'panel-drop-zone',
    },
  });

  if (splitMode === "none" || !secondaryPanel) {
    // Single panel view with drop zone for creating split
    return (
      <div className="h-full relative">
        {primaryPanel && (
          <PanelComponent
            panel={primaryPanel}
            connectionId={connectionId}
            isActive={true}
          />
        )}
        {/* Hidden drop zone that activates on drag */}
        <div
          ref={setDropZoneRef}
          className="absolute inset-y-0 right-0 w-1/3 pointer-events-none"
          data-drop-zone="secondary"
        />
      </div>
    );
  }

  // Split panel view
  return (
    <ResizablePanelGroup
      direction={splitMode === "horizontal" ? "horizontal" : "vertical"}
      className="h-full"
    >
      <ResizablePanel defaultSize={50} minSize={20}>
        {primaryPanel && (
          <PanelComponent
            panel={primaryPanel}
            connectionId={connectionId}
            isActive={true}
          />
        )}
      </ResizablePanel>
      
      <ResizableHandle withHandle />
      
      <ResizablePanel defaultSize={50} minSize={20}>
        {secondaryPanel && (
          <PanelComponent
            panel={secondaryPanel}
            connectionId={connectionId}
            isActive={false}
          />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}