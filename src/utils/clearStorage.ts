/**
 * Comprehensive storage cleaning utilities
 * Clears all application configuration and data
 */

import { invoke } from '@tauri-apps/api/core';

// Legacy function for backward compatibility
export function clearCorruptedConnections() {
  try {
    const stored = localStorage.getItem('connection-storage');
    if (!stored) return;
    
    const data = JSON.parse(stored);
    if (data.state && data.state.connections) {
      // Clear all connections to force re-entry with proper encryption
      data.state.connections = [];
      data.state.activeConnectionId = null;
      localStorage.setItem('connection-storage', JSON.stringify(data));
      console.log('[Storage] Cleared corrupted connections');
    }
  } catch (error) {
    console.error('[Storage] Error clearing connections:', error);
  }
}

export interface ClearStorageOptions {
  clearConnections?: boolean;
  clearWorkspaces?: boolean;
  clearQueries?: boolean;
  clearSettings?: boolean;
  clearCache?: boolean;
  clearSecureStorage?: boolean;
  clearAll?: boolean;
}

export class StorageCleaner {
  /**
   * Clear all application data - complete reset
   */
  static async clearAll(): Promise<void> {
    console.log('[StorageCleaner] Starting complete cleanup...');
    
    try {
      // Clear all localStorage items
      if (typeof window !== 'undefined' && window.localStorage) {
        const keys = Object.keys(window.localStorage);
        console.log(`[StorageCleaner] Clearing ${keys.length} localStorage items`);
        window.localStorage.clear();
      }
      
      // Clear sessionStorage
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.clear();
        console.log('[StorageCleaner] Cleared sessionStorage');
      }
      
      // Clear IndexedDB if present
      await this.clearIndexedDB();
      
      // Clear backend secure storage
      await this.clearBackendStorage();
      
      console.log('[StorageCleaner] ✅ Complete cleanup successful');
      return Promise.resolve();
    } catch (error) {
      console.error('[StorageCleaner] ❌ Cleanup failed:', error);
      throw error;
    }
  }
  
  /**
   * Clear specific storage areas based on options
   */
  static async clearSelective(options: ClearStorageOptions): Promise<void> {
    if (options.clearAll) {
      return this.clearAll();
    }
    
    const tasks: Promise<void>[] = [];
    
    if (options.clearConnections) {
      tasks.push(this.clearConnections());
    }
    
    if (options.clearWorkspaces) {
      tasks.push(this.clearWorkspaces());
    }
    
    if (options.clearQueries) {
      tasks.push(this.clearQueries());
    }
    
    if (options.clearSettings) {
      tasks.push(this.clearSettings());
    }
    
    if (options.clearCache) {
      tasks.push(this.clearCache());
    }
    
    if (options.clearSecureStorage) {
      tasks.push(this.clearBackendStorage());
    }
    
    await Promise.all(tasks);
  }
  
  /**
   * Clear all connection-related data
   */
  static async clearConnections(): Promise<void> {
    console.log('[StorageCleaner] Clearing connections...');
    
    // Clear localStorage items
    const keysToRemove = [
      'connection-storage',
      'secure-connection-store',
      'connections',
      'activeConnectionId'
    ];
    
    keysToRemove.forEach(key => {
      window.localStorage.removeItem(key);
    });
    
    // Also clear any keys that contain these patterns
    Object.keys(window.localStorage).forEach(key => {
      if (key.includes('connection') || key.includes('database')) {
        window.localStorage.removeItem(key);
      }
    });
    
    console.log('[StorageCleaner] ✅ Connections cleared');
  }
  
  /**
   * Clear workspace configuration
   */
  static async clearWorkspaces(): Promise<void> {
    console.log('[StorageCleaner] Clearing workspaces...');
    
    const keysToRemove = [
      'workspace-storage',
      'workspaces',
      'activeWorkspaceId'
    ];
    
    keysToRemove.forEach(key => {
      window.localStorage.removeItem(key);
    });
    
    Object.keys(window.localStorage).forEach(key => {
      if (key.includes('workspace')) {
        window.localStorage.removeItem(key);
      }
    });
    
    console.log('[StorageCleaner] ✅ Workspaces cleared');
  }
  
  /**
   * Clear query history and saved queries
   */
  static async clearQueries(): Promise<void> {
    console.log('[StorageCleaner] Clearing queries...');
    
    const keysToRemove = [
      'query-storage',
      'query-history',
      'saved-queries',
      'recent-queries'
    ];
    
    keysToRemove.forEach(key => {
      window.localStorage.removeItem(key);
    });
    
    Object.keys(window.localStorage).forEach(key => {
      if (key.includes('query') || key.includes('history')) {
        window.localStorage.removeItem(key);
      }
    });
    
    console.log('[StorageCleaner] ✅ Queries cleared');
  }
  
  /**
   * Clear application settings and preferences
   */
  static async clearSettings(): Promise<void> {
    console.log('[StorageCleaner] Clearing settings...');
    
    const keysToRemove = [
      'theme',
      'vite-ui-theme',
      'settings',
      'preferences',
      'app-config'
    ];
    
    keysToRemove.forEach(key => {
      window.localStorage.removeItem(key);
    });
    
    Object.keys(window.localStorage).forEach(key => {
      if (key.includes('setting') || key.includes('preference') || key.includes('config')) {
        window.localStorage.removeItem(key);
      }
    });
    
    console.log('[StorageCleaner] ✅ Settings cleared');
  }
  
  /**
   * Clear cache data
   */
  static async clearCache(): Promise<void> {
    console.log('[StorageCleaner] Clearing cache...');
    
    // Clear localStorage cache items
    Object.keys(window.localStorage).forEach(key => {
      if (key.includes('cache')) {
        window.localStorage.removeItem(key);
      }
    });
    
    // Clear browser caches if available
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log(`[StorageCleaner] Deleted ${cacheNames.length} caches`);
      } catch (error) {
        console.warn('[StorageCleaner] Could not clear caches:', error);
      }
    }
    
    console.log('[StorageCleaner] ✅ Cache cleared');
  }
  
  /**
   * Clear IndexedDB databases
   */
  private static async clearIndexedDB(): Promise<void> {
    if (!('indexedDB' in window)) {
      return;
    }
    
    console.log('[StorageCleaner] Clearing IndexedDB...');
    
    try {
      // Get database names if available
      if (indexedDB.databases) {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            await this.deleteDatabase(db.name);
            console.log(`[StorageCleaner] Deleted IndexedDB: ${db.name}`);
          }
        }
      }
    } catch (error) {
      console.warn('[StorageCleaner] Could not clear IndexedDB:', error);
    }
  }
  
  /**
   * Delete a specific IndexedDB database
   */
  private static deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteReq = indexedDB.deleteDatabase(name);
      deleteReq.onsuccess = () => { resolve(); };
      deleteReq.onerror = () => { reject(deleteReq.error); };
      deleteReq.onblocked = () => {
        console.warn(`[StorageCleaner] Delete of ${name} blocked`);
        resolve();
      };
    });
  }
  
  /**
   * Clear backend secure storage
   */
  private static async clearBackendStorage(): Promise<void> {
    console.log('[StorageCleaner] Clearing backend secure storage...');
    
    try {
      // Delete all connections from secure storage
      await invoke('delete_all_connections');
      console.log('[StorageCleaner] ✅ Deleted all connections from secure storage');
      
      // Try to clear all secure storage if available
      try {
        await invoke('clear_all_storage', { confirmation: 'CONFIRM_DELETE_ALL' });
        console.log('[StorageCleaner] ✅ Backend storage cleared');
      } catch (storageError) {
        console.warn('[StorageCleaner] Full storage clear not available:', storageError);
      }
    } catch (error) {
      console.warn('[StorageCleaner] Backend storage clear failed:', error);
    }
  }
  
  /**
   * Get storage usage statistics
   */
  static async getStorageStats(): Promise<{
    localStorage: { items: number; size: number };
    sessionStorage: { items: number; size: number };
    indexedDB: number;
    total: number;
  }> {
    let localStorageSize = 0;
    let localStorageItems = 0;
    let sessionStorageSize = 0;
    let sessionStorageItems = 0;
    let indexedDBSize = 0;
    
    // Calculate localStorage
    if (window.localStorage) {
      localStorageItems = window.localStorage.length;
      for (const key in window.localStorage) {
        const value = window.localStorage.getItem(key) || '';
        localStorageSize += key.length + value.length;
      }
    }
    
    // Calculate sessionStorage
    if (window.sessionStorage) {
      sessionStorageItems = window.sessionStorage.length;
      for (const key in window.sessionStorage) {
        const value = window.sessionStorage.getItem(key) || '';
        sessionStorageSize += key.length + value.length;
      }
    }
    
    // Estimate IndexedDB size
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        indexedDBSize = estimate.usage || 0;
      } catch (error) {
        console.warn('[StorageCleaner] Could not estimate storage:', error);
      }
    }
    
    return {
      localStorage: { items: localStorageItems, size: localStorageSize },
      sessionStorage: { items: sessionStorageItems, size: sessionStorageSize },
      indexedDB: indexedDBSize,
      total: localStorageSize + sessionStorageSize + indexedDBSize
    };
  }
  
  /**
   * List all localStorage keys
   */
  static listStorageKeys(): string[] {
    return Object.keys(window.localStorage);
  }
}

// Export convenience functions
export const clearAllStorage = () => StorageCleaner.clearAll();
export const clearConnections = () => StorageCleaner.clearConnections();
export const clearWorkspaces = () => StorageCleaner.clearWorkspaces();
export const clearQueries = () => StorageCleaner.clearQueries();
export const clearSettings = () => StorageCleaner.clearSettings();
export const clearCache = () => StorageCleaner.clearCache();
export const getStorageStats = () => StorageCleaner.getStorageStats();
export const listStorageKeys = () => StorageCleaner.listStorageKeys();
