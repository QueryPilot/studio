import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ConnectionStatus = 'ready' | 'degraded' | 'reconnecting' | 'error';

export interface ConnectionHealth {
  connectionId: string;
  status: ConnectionStatus;
  lastPing?: Date;
  rttMs?: number;
  reason?: string;
  missCount?: number;
}

interface ConnectionHealthStore {
  health: Map<string, ConnectionHealth>;
  updateHealth: (connectionId: string, health: Partial<ConnectionHealth>) => void;
  getHealth: (connectionId: string) => ConnectionHealth | undefined;
  clearHealth: (connectionId: string) => void;
  clearAllHealth: () => void;
}

export const useConnectionHealthStore = create<ConnectionHealthStore>()(
  persist(
    (set, get) => ({
      health: new Map(),
      
      updateHealth: (connectionId: string, healthUpdate: Partial<ConnectionHealth>) => {
        console.log('[connectionHealthStore] updateHealth called:', {
          connectionId,
          healthUpdate,
        });
        set((state) => {
          const newHealth = new Map(state.health);
          const existing = newHealth.get(connectionId) || { 
            connectionId, 
            status: 'ready' as ConnectionStatus 
          };
          
          const updated = {
            ...existing,
            ...healthUpdate,
            lastPing: healthUpdate.lastPing || new Date(),
          };
          
          newHealth.set(connectionId, updated);
          console.log('[connectionHealthStore] Updated health for', connectionId, ':', updated);
          
          return { health: newHealth };
        });
      },
      
      getHealth: (connectionId: string) => {
        return get().health.get(connectionId);
      },
      
      clearHealth: (connectionId: string) => {
        set((state) => {
          const newHealth = new Map(state.health);
          newHealth.delete(connectionId);
          return { health: newHealth };
        });
      },
      
      clearAllHealth: () => {
        set({ health: new Map() });
      },
    }),
    {
      name: 'connection-health-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          // Convert array back to Map and restore Date objects
          const healthEntries = parsed.state.health.map(([key, value]: [string, any]) => {
            // Convert lastPing string back to Date object if it exists
            if (value.lastPing) {
              value.lastPing = new Date(value.lastPing);
            }
            return [key, value];
          });
          return {
            state: {
              health: new Map(healthEntries),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            state: {
              health: Array.from(value.state.health.entries()),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);