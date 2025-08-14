/**
 * Emergency connection clearing utility
 * Use this when connections are stuck or corrupted
 */

import { invoke } from '@tauri-apps/api/core';

export async function emergencyClearAllConnections(): Promise<void> {
  console.log('[EmergencyClear] Starting emergency connection cleanup...');
  
  try {
    // 1. Clear all from backend secure storage
    try {
      const deleted = await invoke('delete_all_connections');
      console.log(`[EmergencyClear] Deleted ${deleted} connections from backend`);
    } catch (error) {
      console.error('[EmergencyClear] Backend deletion failed:', error);
    }
    
    // 2. Clear all localStorage related to connections
    const connectionKeys = Object.keys(localStorage).filter(key => 
      key.includes('connection') || 
      key.includes('secure-connection') ||
      key.includes('database') ||
      key.includes('workspace')
    );
    
    connectionKeys.forEach(key => {
      localStorage.removeItem(key);
      console.log(`[EmergencyClear] Cleared localStorage key: ${key}`);
    });
    
    // 3. Clear specific known keys
    const knownKeys = [
      'connection-storage',
      'secure-connection-store',
      'workspace-storage',
      'activeConnectionId',
      'activeWorkspaceId'
    ];
    
    knownKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    // 4. Clear sessionStorage
    sessionStorage.clear();
    
    console.log('[EmergencyClear] ✅ Emergency cleanup completed');
    
    // 5. Try to reload connections from backend before reload
    try {
      const { useSecureConnectionStore } = await import('@/stores/secureConnectionStore');
      await useSecureConnectionStore.getState().loadConnections();
      console.log('[EmergencyClear] Reloaded connections from backend');
    } catch (error) {
      console.error('[EmergencyClear] Failed to reload connections:', error);
    }
    
    // 6. Force reload to reset all state
    setTimeout(() => {
      window.location.reload();
    }, 1000);
    
  } catch (error) {
    console.error('[EmergencyClear] Emergency cleanup failed:', error);
    throw error;
  }
}