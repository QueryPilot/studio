import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useConnectionHealthStore, type ConnectionStatus } from '@/stores/connectionHealthStore';

interface ConnectionHealthEvent {
  connectionId: string;
  status: ConnectionStatus;
  reason?: string;
  rttMs?: number;
  at: number;
}

interface RecoveredEvent {
  connectionId: string;
  attempts: number;
}

interface ConnectionErrorEvent {
  connectionId: string;
  error: string;
}

export function useConnectionHealth(connectionId?: string) {
  const { updateHealth, getHealth } = useConnectionHealthStore();
  const health = connectionId ? getHealth(connectionId) : undefined;
  
  useEffect(() => {
    console.log('[useConnectionHealth] Setting up event listeners for connectionId:', connectionId);
    
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];
    
    // Setup all event listeners
    const setupListeners = async () => {
      try {
        // Listen for connection status updates
        const statusUnlisten = await listen<ConnectionHealthEvent>('db:connection_status', (event) => {
          if (!mounted) return;
          
          const { connectionId: eventConnId, status, rttMs, reason, at } = event.payload;
          console.log('[useConnectionHealth] Received db:connection_status event:', {
            eventConnId,
            targetConnectionId: connectionId,
            status,
            rttMs,
            reason,
            at,
          });
          
          // Update health store
          updateHealth(eventConnId, {
            status,
            rttMs,
            reason,
            lastPing: new Date(at),
          });
          
          // Show notifications for the active connection
          if (!connectionId || connectionId === eventConnId) {
            if (status === 'error') {
              toast.error(`Connection lost: ${reason || 'Unknown error'}`, {
                action: {
                  label: 'Retry',
                  onClick: () => retryConnection(eventConnId),
                },
              });
            } else if (status === 'degraded' && rttMs && rttMs > 500) {
              toast.warning(`Connection degraded: ${rttMs}ms latency`);
            } else if (status === 'reconnecting') {
              toast.info('Attempting to reconnect...');
            }
          }
        });
        unlisteners.push(statusUnlisten);
        
        // Listen for connection recovery
        const recoveryUnlisten = await listen<RecoveredEvent>('db:connection_recovered', (event) => {
          if (!mounted) return;
          
          const { connectionId: eventConnId, attempts } = event.payload;
          
          updateHealth(eventConnId, {
            status: 'ready',
            reason: undefined,
          });
          
          if (!connectionId || connectionId === eventConnId) {
            toast.success(`Connection restored after ${attempts} attempt${attempts > 1 ? 's' : ''}`);
          }
        });
        unlisteners.push(recoveryUnlisten);
        
        // Listen for connection errors
        const errorUnlisten = await listen<ConnectionErrorEvent>('db:connection_error', (event) => {
          if (!mounted) return;
          
          const { connectionId: eventConnId, error } = event.payload;
          
          updateHealth(eventConnId, {
            status: 'error',
            reason: error,
          });
          
          if (!connectionId || connectionId === eventConnId) {
            toast.error(`Connection error: ${error}`);
          }
        });
        unlisteners.push(errorUnlisten);
        
      } catch (error) {
        console.error('[useConnectionHealth] Failed to setup event listeners:', error);
      }
    };
    
    // Start setting up listeners
    setupListeners();
    
    // Browser online/offline detection
    const handleOffline = () => {
      if (!mounted) return;
      toast.warning('You are offline. Database connections may be affected.');
    };
    
    const handleOnline = () => {
      if (!mounted) return;
      toast.success('Back online. Checking database connections...');
    };
    
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    
    // Cleanup
    return () => {
      mounted = false;
      
      // Unlisten all Tauri event listeners
      unlisteners.forEach(unlisten => {
        try {
          unlisten();
        } catch (error) {
          console.error('[useConnectionHealth] Error during unlisten:', error);
        }
      });
      
      // Remove browser event listeners
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [connectionId, updateHealth, getHealth]);
  
  return {
    health,
    isHealthy: health?.status === 'ready',
    isDegraded: health?.status === 'degraded',
    isReconnecting: health?.status === 'reconnecting',
    isError: health?.status === 'error',
    canExecute: health?.status === 'ready' || health?.status === 'degraded',
    canEdit: health?.status === 'ready',
  };
}

async function retryConnection(connectionId: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('test_connection', { connectionId });
    toast.success('Connection retry successful');
  } catch {
    toast.error('Connection retry failed');
  }
}