import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GridRenderer } from './GridRenderer';
import { Direction } from '@/types/workbench';
import useWorkbenchStore from '@/stores/workbenchStore';

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
    resetLayout,
    layoutHistory,
    historyIndex
  } = useWorkbenchStore();
  
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
  
  
  if (!layoutTree) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-muted-foreground">Initializing workbench...</div>
      </div>
    );
  }
  
  return (
    <div className={cn('workbench-layout h-full overflow-hidden border-x border-b border-border', className)}>
      <GridRenderer node={layoutTree} className="h-full" />
    </div>
  );
};