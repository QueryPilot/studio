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
    console.log('[useConnectionHealth] Current health store state:', getHealth(connectionId || ''));
    
    // Test if Tauri events are working at all
    const testListener = listen('test-event', (event) => {
      console.log('[useConnectionHealth] Received test event:', event);
    });
    
    const unlisteners: Promise<UnlistenFn>[] = [testListener];
    
    // Listen for all possible db events to debug
    unlisteners.push(
      listen('db:connection_recovered', (event) => {
        console.log('[useConnectionHealth] Received db:connection_recovered:', event);
      })
    );
    
    unlisteners.push(
      listen('db:connection_error', (event) => {
        console.log('[useConnectionHealth] Received db:connection_error:', event);
      })
    );
    
    // Listen for connection status updates
    unlisteners.push(
      listen<ConnectionHealthEvent>('db:connection_status', (event) => {
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
        
        // Show notifications for the active connection (or all if debugging)
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
      })
    );
    
    // Listen for connection recovery
    unlisteners.push(
      listen<RecoveredEvent>('db:connection_recovered', (event) => {
        const { connectionId: eventConnId, attempts } = event.payload;
        
        updateHealth(eventConnId, {
          status: 'ready',
          reason: undefined,
        });
        
        if (!connectionId || connectionId === eventConnId) {
          toast.success(`Connection restored after ${attempts} attempt${attempts > 1 ? 's' : ''}`);
        }
      })
    );
    
    // Listen for connection errors
    unlisteners.push(
      listen<ConnectionErrorEvent>('db:connection_error', (event) => {
        const { connectionId: eventConnId, error } = event.payload;
        
        updateHealth(eventConnId, {
          status: 'error',
          reason: error,
        });
        
        if (!connectionId || connectionId === eventConnId) {
          toast.error(`Connection error: ${error}`);
        }
      })
    );
    
    // Browser online/offline detection
    const handleOffline = () => {
      toast.warning('You are offline. Database connections may be affected.');
    };
    
    const handleOnline = () => {
      toast.success('Back online. Checking database connections...');
      // Could trigger a health check for all connections here
    };
    
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    
    // Cleanup
    return () => {
      Promise.all(unlisteners).then((fns) => {
        fns.forEach((fn) => { fn(); });
      });
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      
      // Don't clear health on unmount as it should persist
    };
  }, [connectionId, updateHealth]);
  
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