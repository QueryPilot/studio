import { KeyboardManager } from '../KeyboardManager';
import type { ViewContext } from '../types';

// Import stores (these imports might need adjustment based on actual store exports)
import { useWorkspaceScreenStore } from '@/stores/workspaceScreenStore';
import { usePanelStore } from '@/stores/panelStore';
import useWorkbenchStore from '@/stores/workbenchStore';

// Integration helper to sync store state with keyboard context
export function setupStoreIntegration(): () => void {
  const manager = KeyboardManager.getInstance();
  const unsubscribers: (() => void)[] = [];

  // Subscribe to workspace screen store
  const workspaceUnsubscribe = useWorkspaceScreenStore.subscribe(state => {
    manager.updateContext({
      leftSidebarVisible: state.sidebars.left,
      rightSidebarVisible: state.sidebars.right,
    });
  });
  unsubscribers.push(workspaceUnsubscribe);

  // Subscribe to workbench store for focused panel
  const workbenchUnsubscribe = useWorkbenchStore.subscribe(state => {
    const focusedPanelId = state.focusedPanelId;
    if (focusedPanelId) {
      // Derive view context from panel ID
      const viewContext = deriveViewContext(focusedPanelId);
      manager.updateContext({ activeView: viewContext });
    }
  });
  unsubscribers.push(workbenchUnsubscribe);

  // Subscribe to panel store for panel-specific state
  const panelUnsubscribe = usePanelStore.subscribe(state => {
    // Get active panel state
    const panels = state.panels;
    const focusedPanelId = useWorkbenchStore.getState().focusedPanelId;

    if (focusedPanelId && panels) {
      // Since panels is a Map, we need to iterate to find the panel
      let activePanel: any = null;
      panels.forEach((panel: any) => {
        if (panel.id === focusedPanelId) {
          activePanel = panel;
        }
      });

      if (activePanel) {
        // Update context based on panel state
        manager.updateContext({
          isDirty: activePanel.isDirty || false,
          hasSelection: activePanel.hasSelection || false,
        });
      }
    }
  });
  unsubscribers.push(panelUnsubscribe);

  // Return cleanup function
  return () => {
    unsubscribers.forEach(unsubscribe => { unsubscribe(); });
  };
}

// Helper to derive view context from panel ID or type
function deriveViewContext(panelId: string): ViewContext {
  // Check panel type from ID or other metadata
  if (panelId.includes('query')) return 'queryEditor';
  if (panelId.includes('table')) return 'tableView';
  if (panelId.includes('schema')) return 'schemaView';
  if (panelId.includes('result')) return 'resultView';
  if (panelId.includes('function')) return 'functionView';
  if (panelId.includes('erd')) return 'erdView';

  // Check for sidebars
  if (panelId.includes('sidebar-left')) return 'sidebar.database';
  if (panelId.includes('sidebar-right')) return 'sidebar.ai';

  // Default to workbench for panel management
  if (panelId.includes('panel')) return 'workbench';

  return 'global';
}

// Hook to sync connection state
export function useSyncConnectionState(connectionId?: string): void {
  const manager = KeyboardManager.getInstance();

  // Update connection state in keyboard context
  if (connectionId) {
    manager.updateContext({
      isConnected: true,
      // Other connection-related state can be added here
    });
  } else {
    manager.updateContext({
      isConnected: false,
      queryRunning: false,
      hasResults: false,
    });
  }
}

// Hook to sync query execution state
export function useSyncQueryState(isExecuting: boolean, hasResults: boolean): void {
  const manager = KeyboardManager.getInstance();

  manager.updateContext({
    queryRunning: isExecuting,
    hasResults,
  });
}

// Hook to sync editor state
export function useSyncEditorState(
  hasSelection: boolean,
  isDirty: boolean,
  isEditing: boolean
): void {
  const manager = KeyboardManager.getInstance();

  manager.updateContext({
    hasSelection,
    isDirty,
    isEditing,
  });
}

// Hook to sync workbench state
export function useSyncWorkbenchState(hasFocusedPanel: boolean, _panelCount: number): void {
  const manager = KeyboardManager.getInstance();

  manager.updateContext({
    focusedPanel: hasFocusedPanel,
    // Add more workbench-specific state as needed
    // panelCount could be used for context like 'multiplePanel' when: 'panelCount > 1'
  });
}