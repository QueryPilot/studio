import { Panel as PanelComponent } from "./Panel";
import { usePanelStore } from "@/stores/panelStore";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDroppable,
} from "@dnd-kit/core";
import { useState } from "react";
import type { TabState } from "@/types/workspaceScreen";

interface WorkspacePanelContainerProps {
  connectionId: string;
}

export function WorkspacePanelContainer({ connectionId }: WorkspacePanelContainerProps) {
  const { panels, splitMode, setSplitMode, createPanel, moveTabBetweenPanels, reorderTabInPanel } = usePanelStore();
  const [draggedTab, setDraggedTab] = useState<TabState | null>(null);
  const [draggedFromPanelId, setDraggedFromPanelId] = useState<string | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  
  // Get primary and secondary panels
  const primaryPanel = Array.from(panels.values()).find(p => p.type === "primary");
  const secondaryPanel = Array.from(panels.values()).find(p => p.type === "secondary");

  // Setup droppable zone for creating secondary panel
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: 'new-secondary-panel',
    data: {
      type: 'panel-drop-zone',
      panelId: 'new-secondary',
    },
    disabled: !!secondaryPanel,
  });

  const handleDragStart = (event: DragStartEvent) => {
    const tabId = event.active.id as string;
    const sourcePanel = Array.from(panels.values()).find(panel => 
      panel.tabs.has(tabId)
    );
    
    if (sourcePanel) {
      const tab = sourcePanel.tabs.get(tabId);
      if (tab) {
        setDraggedTab(tab);
        setDraggedFromPanelId(sourcePanel.id);
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    if (!over || !draggedTab || !draggedFromPanelId) return;
    
    const activeId = active.id as string;
    const overId = over.id as string;
    
    // Check if we're over a tab in the same panel (reordering)
    if (activeId !== overId) {
      const overPanel = Array.from(panels.values()).find(panel => 
        panel.tabs.has(overId)
      );
      
      if (overPanel && overPanel.id === draggedFromPanelId) {
        // Reordering within the same panel
        const oldIndex = overPanel.tabOrder.indexOf(activeId);
        const newIndex = overPanel.tabOrder.indexOf(overId);
        
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          reorderTabInPanel(overPanel.id, activeId, newIndex);
        }
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    
    if (!draggedTab || !draggedFromPanelId) {
      setDraggedTab(null);
      setDraggedFromPanelId(null);
      return;
    }
    
    if (!over) {
      setDraggedTab(null);
      setDraggedFromPanelId(null);
      return;
    }
    
    const overId = over.id as string;
    const activeId = active.id as string;
    
    // Check if dropped on the new secondary panel zone
    if (overId === 'new-secondary-panel' && !secondaryPanel) {
      // Create secondary panel and move tab there
      const newPanelId = createPanel("secondary");
      setSplitMode("horizontal");
      // Move the tab immediately
      moveTabBetweenPanels(activeId, draggedFromPanelId, newPanelId);
    } else {
      // Check if dropped on another panel's tab
      const targetPanel = Array.from(panels.values()).find(panel => 
        panel.tabs.has(overId)
      );
      
      if (targetPanel && targetPanel.id !== draggedFromPanelId) {
        // Move to existing panel
        moveTabBetweenPanels(activeId, draggedFromPanelId, targetPanel.id);
      }
    }
    
    setDraggedTab(null);
    setDraggedFromPanelId(null);
  };

  if (splitMode === "none" || !secondaryPanel) {
    // Single panel view
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="h-full relative">
          {primaryPanel && (
            <div className="h-full" data-panel-id={primaryPanel.id}>
              <PanelComponent
                panel={primaryPanel}
                connectionId={connectionId}
                isActive={true}
              />
            </div>
          )}
          
          {/* Drop zone for creating split panel - always present but only visible when dragging */}
          {draggedTab && (
            <div
              ref={setDroppableRef}
              className={`absolute inset-y-0 right-0 w-1/2 z-50 transition-all
                bg-primary/10 border-2 border-dashed border-primary/30
                ${isOver ? "bg-primary/20 border-primary/50" : ""}`}
              data-panel-id="new-secondary"
              data-type="panel-drop-zone"
            >
              <div className="flex items-center justify-center h-full pointer-events-none">
                <div className="text-center">
                  <p className="text-sm font-medium text-primary">Drop here to split panel</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DragOverlay>
          {draggedTab && (
            <div className="bg-background border rounded shadow-lg px-3 py-1">
              <span className="text-sm">{draggedTab.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    );
  }

  // Split panel view
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <ResizablePanelGroup
        direction={splitMode === "horizontal" ? "horizontal" : "vertical"}
        className="h-full"
      >
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="h-full" data-panel-id={primaryPanel?.id}>
            {primaryPanel && (
              <PanelComponent
                panel={primaryPanel}
                connectionId={connectionId}
                isActive={true}
              />
            )}
          </div>
        </ResizablePanel>
        
        <ResizableHandle withHandle />
        
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="h-full" data-panel-id={secondaryPanel?.id}>
            {secondaryPanel && (
              <PanelComponent
                panel={secondaryPanel}
                connectionId={connectionId}
                isActive={false}
              />
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <DragOverlay>
        {draggedTab && (
          <div className="bg-background border rounded shadow-lg px-3 py-1">
            <span className="text-sm">{draggedTab.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}