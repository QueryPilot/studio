import { useEffect } from 'react';
import useWorkbenchStore from '@/stores/workbenchStore';
import { usePanelStore } from '@/stores/panelStore';
import { type PanelType } from '@/types/workbench';

export function useWorkbenchIntegration(connectionId: string) {
  const { 
    layoutTree, 
    focusedPanelId,
    addTab,
    removeTab,
    setActiveTab 
  } = useWorkbenchStore();
  
  const { panels, activePanel } = usePanelStore();
  
  useEffect(() => {
    if (!layoutTree || !focusedPanelId) return;
    
    const connectionPanels = panels.filter(p => p.connectionId === connectionId);
    
    connectionPanels.forEach(panel => {
      const tabId = `${panel.type}-${panel.id}`;
      const panelType: PanelType = panel.type === 'query' ? 'editor' : 
                                   panel.type === 'table' ? 'editor' : 'custom';
      
      const existingPanel = useWorkbenchStore.getState().panelContents.get(focusedPanelId);
      
      if (existingPanel && !existingPanel.tabIds.includes(tabId)) {
        addTab(focusedPanelId, tabId, {
          type: panel.type,
          title: panel.title,
          connectionId: panel.connectionId,
          metadata: panel.metadata
        });
      }
    });
    
    if (activePanel) {
      const activeTabId = `${activePanel.type}-${activePanel.id}`;
      setActiveTab(focusedPanelId, activeTabId);
    }
  }, [panels, activePanel, layoutTree, focusedPanelId, connectionId, addTab, setActiveTab]);
  
  const openInNewPanel = (tabType: string, tabId: string, metadata?: any) => {
    if (!focusedPanelId) return;
    
    useWorkbenchStore.getState().splitPanelAction({
      targetPanelId: focusedPanelId,
      direction: 'right',
      newPanelContent: {
        id: '',
        type: 'editor',
        tabIds: [tabId],
        activeTabId: tabId,
        metadata: { [tabId]: metadata }
      }
    });
  };
  
  return {
    openInNewPanel
  };
}