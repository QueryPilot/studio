/**
 * Test utilities for workspace tab management
 */
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function testWorkspaceTabManagement() {
  const store = useWorkspaceStore.getState();
  
  // Create a test workspace
  const workspaceId = store.addWorkspace({
    name: 'Test Workspace',
    path: '/test',
    connectionIds: [],
    activeConnectionId: null,
    activeTabId: null,
    settings: {
      defaultPageSize: 50,
      autoSave: true,
      confirmOnClose: true,
      theme: 'system',
      maxTabsOpen: 20
    },
    lastOpened: new Date()
  });
  
  console.log('Created workspace:', workspaceId);
  
  // Add a query tab
  const queryTabId = store.addTab(workspaceId, {
    type: 'query',
    title: 'Test Query',
    connectionId: 'test-connection',
    payload: {
      sql: 'SELECT * FROM users;'
    }
  });
  
  console.log('Added query tab:', queryTabId);
  
  // Add a table tab
  const tableTabId = store.addTab(workspaceId, {
    type: 'table',
    title: 'users',
    connectionId: 'test-connection',
    payload: {
      schema: 'public',
      tableName: 'users'
    }
  });
  
  console.log('Added table tab:', tableTabId);
  
  // Test tab switching
  store.setActiveTab(workspaceId, queryTabId);
  console.log('Active tab:', store.getActiveTab()?.id);
  
  store.setActiveTab(workspaceId, tableTabId);
  console.log('Active tab after switch:', store.getActiveTab()?.id);
  
  // Test tab updates
  store.updateTabPayload(workspaceId, queryTabId, {
    sql: 'SELECT * FROM users WHERE active = true;'
  });
  
  // Test tab removal
  store.closeTab(workspaceId, tableTabId);
  console.log('Tabs after closing:', store.getWorkspace(workspaceId)?.tabOrder);
  
  // Clean up
  store.removeWorkspace(workspaceId);
  console.log('Test completed successfully!');
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).testWorkspaceTabs = testWorkspaceTabManagement;
}