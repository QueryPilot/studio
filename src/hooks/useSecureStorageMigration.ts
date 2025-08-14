import { useEffect, useState } from 'react';
import { secureStorage } from '@/services/secureStorage';
import { useSecureConnectionStore } from '@/stores/secureConnectionStore';
import { useSecureQueryStore } from '@/stores/secureQueryStore';

/**
 * Hook to handle migration from localStorage to secure storage
 * This runs once when the app starts to migrate existing data
 */
export function useSecureStorageMigration() {
  const [migrationStatus, setMigrationStatus] = useState<'pending' | 'migrating' | 'completed' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  
  const loadConnections = useSecureConnectionStore(state => state.loadConnections);
  const loadHistory = useSecureQueryStore(state => state.loadHistory);
  const loadSavedQueries = useSecureQueryStore(state => state.loadSavedQueries);

  useEffect(() => {
    const migrate = async () => {
      try {
        setMigrationStatus('migrating');
        
        // Check if migration is needed
        const hasLocalData = 
          localStorage.getItem('connection-storage') !== null ||
          localStorage.getItem('query-storage') !== null;
        
        if (hasLocalData) {
          console.log('Starting migration from localStorage to secure storage...');
          
          // Perform migration
          await secureStorage.migrateFromLocalStorage();
          
          console.log('Migration completed successfully');
        }
        
        // Load data from secure storage
        await Promise.all([
          loadConnections(),
          loadHistory(),
          loadSavedQueries()
        ]);
        
        setMigrationStatus('completed');
        
        // Clear any remaining localStorage data
        const keysToRemove = [
          'connection-storage',
          'query-storage',
          'theme',
          'workspace-state'
        ];
        
        keysToRemove.forEach(key => {
          if (localStorage.getItem(key)) {
            console.log(`Removing ${key} from localStorage`);
            localStorage.removeItem(key);
          }
        });
        
        // Clear sessionStorage as well
        sessionStorage.clear();
        
      } catch (err) {
        console.error('Migration failed:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setMigrationStatus('error');
      }
    };
    
    migrate();
  }, []); // Empty dependency array - only run once on mount
  // Note: loadConnections, loadHistory, loadSavedQueries are stable references from zustand
  
  return {
    migrationStatus,
    error,
    isReady: migrationStatus === 'completed',
  };
}