import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { GridRenderer } from './GridRenderer';
import { Direction } from '@/types/workbench';
import useWorkbenchStore from '@/stores/workbenchStore';
import { 
  DndContext, 
  DragOverlay, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent
} from '@dnd-kit/core';

interface WorkbenchLayoutProps {
  className?: string;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({ className }) => {
  const { 
    layoutTree, 
    focusedPanelId,
    initializeLayout,
    splitPanelAction,
    focusAdjacentPanel,
    undo,
    redo,
    moveTab
  } = useWorkbenchStore();
  
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{ tabId: string; panelId: string } | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  
  useEffect(() => {
    if (!layoutTree) {
      initializeLayout();
    }
  }, [layoutTree, initializeLayout]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      
      if (!modKey) return;
      
      if (e.key === '\\' && focusedPanelId) {
        e.preventDefault();
        const direction: Direction = e.shiftKey ? 'down' : 'right';
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction,
          splitRatio: 0.5
        });
      }
      
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
      
      if (e.key === 'k') {
        const keyHandler = (e2: KeyboardEvent) => {
          e2.preventDefault();
          const directionMap: Record<string, Direction> = {
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'ArrowUp': 'up',
            'ArrowDown': 'down'
          };
          
          const direction = directionMap[e2.key];
          if (direction) {
            focusAdjacentPanel(direction);
          }
          
          window.removeEventListener('keydown', keyHandler);
        };
        
        window.addEventListener('keydown', keyHandler);
        setTimeout(() => window.removeEventListener('keydown', keyHandler), 1000);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedPanelId, splitPanelAction, focusAdjacentPanel, undo, redo]);
  
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
    
    // Parse the tab and panel info from the draggable ID
    if (active.data.current) {
      const tabInfo = active.data.current as { tabId: string; panelId: string };
      setActiveTabInfo(tabInfo);
      
      // Update the global store so panels can react
      const state = useWorkbenchStore.getState();
      state.setDragContext({
        draggedTab: { id: tabInfo.tabId, panelId: tabInfo.panelId }
      });
    }
    
    console.log('🚀 Global drag started:', active.id, active.data.current);
  };
  
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    console.log('🔄 Drag over:', { active: active?.id, over: over?.id });
  };
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    console.log('🏁 Global drag ended:', { 
      active: active?.id, 
      over: over?.id, 
      activeData: active?.data.current,
      overData: over?.data.current 
    });
    
    setActiveId(null);
    setActiveTabInfo(null);
    
    // Clear the global drag context
    const state = useWorkbenchStore.getState();
    state.clearDragContext();
    
    if (!over || !active.data.current || !over.data.current) return;
    
    const activeData = active.data.current as { tabId: string; panelId: string };
    const overData = over.data.current as { panelId: string; position: string };
    
    const { tabId, panelId: sourcePanelId } = activeData;
    const { panelId: targetPanelId, position } = overData;
    
    console.log(`💧 Processing drop: ${tabId} from ${sourcePanelId} to ${targetPanelId} at ${position}`);
    
    if (position === 'center') {
      // Move tab to existing panel
      moveTab(tabId, sourcePanelId, targetPanelId);
    } else {
      // Create new panel with tab
      const directionMap: Record<string, Direction> = {
        top: 'up',
        bottom: 'down',
        left: 'left',
        right: 'right',
      };
      
      const state = useWorkbenchStore.getState();
      const sourcePanel = state.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];
      
      const newPanelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      splitPanelAction({
        targetPanelId,
        direction: directionMap[position],
        newPanelContent: {
          id: newPanelId,
          type: 'editor',
          tabIds: [tabId],
          activeTabId: tabId,
          metadata: tabMetadata ? { [tabId]: tabMetadata } : undefined,
        },
      });
      
      // Remove from source panel
      state.removeTab(sourcePanelId, tabId);
    }
  };
  
  if (!layoutTree) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-muted-foreground">Initializing workbench...</div>
      </div>
    );
  }
  
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className={cn('workbench-layout h-full overflow-hidden border-x border-b border-border', className)}>
        <GridRenderer node={layoutTree} className="h-full" />
      </div>
      
      <DragOverlay>
        {activeId && activeTabInfo && (
          <div className="px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground shadow-lg">
            {activeTabInfo.tabId.split('-').pop()}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};