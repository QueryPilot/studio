# P0-00A: Frontend State Architecture Refactor ✅ COMPLETED

## Priority
P0 - Critical Foundation (BLOCKS P0-003: Workspace-Scoped Tabs)

## Dependencies
- Should be done in parallel with P0-000 (Backend Refactor)

## Estimated Effort
8-10 hours

## Problem Statement
Current frontend state management is incomplete and not aligned with the workspace-scoped architecture. Tabs are stored globally, have no connection binding, and state is lost on refresh. No caching layer exists for performance optimization.

## Current State Issues
- **Global tab state** instead of workspace-scoped
- **No connection binding** - Tabs don't know which connection to use
- **State persistence broken** - Lost on page refresh
- **No cache layer** - Every query hits the backend
- **Poor separation** - Mixed concerns in stores
- **No optimistic updates** - Poor UX for edits

## Acceptance Criteria
- [x] Workspace store includes tab management
- [x] Each tab bound to specific connection
- [x] State persists across page refreshes
- [x] Cache layer implemented (LRU + IndexedDB)
- [x] Proper TypeScript types throughout
- [x] React hooks for data fetching
- [x] Optimistic updates for edits
- [x] Clean store separation

## Implementation Plan

### 1. Refactor WorkspaceStore with Tabs
```typescript
// src/stores/workspaceStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface TabState {
  id: string;
  type: 'query' | 'table' | 'schema' | 'result';
  connectionId: string;  // REQUIRED: Each tab must have a connection
  title: string;
  icon?: string;
  
  // Tab-specific data
  payload: {
    // For query tabs
    sql?: string;
    cursorId?: string;
    
    // For table tabs
    schema?: string;
    tableName?: string;
    filters?: ColumnFilter[];
    sort?: SortConfig;
    
    // For result tabs
    resultId?: string;
    parentQueryId?: string;
  };
  
  // UI state
  ui: {
    scrollTop: number;
    scrollLeft: number;
    columnWidths: Record<string, number>;
    selectedRows: Set<string>;
    expandedRows: Set<string>;
  };
  
  // Metadata
  isDirty: boolean;
  isLoading: boolean;
  error?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface WorkspaceState {
  id: string;
  name: string;
  
  // Connections in this workspace
  connectionIds: string[];
  activeConnectionId: string | null;
  
  // Tabs in this workspace
  tabs: Map<string, TabState>;
  tabOrder: string[];  // For maintaining tab order
  activeTabId: string | null;
  
  // Workspace settings
  settings: {
    defaultPageSize: number;
    autoSave: boolean;
    confirmOnClose: boolean;
  };
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

interface WorkspaceStore {
  // State
  workspaces: Map<string, WorkspaceState>;
  activeWorkspaceId: string | null;
  
  // Workspace actions
  createWorkspace: (name: string) => string;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  
  // Connection actions
  addConnection: (workspaceId: string, connectionId: string) => void;
  removeConnection: (workspaceId: string, connectionId: string) => void;
  setActiveConnection: (workspaceId: string, connectionId: string) => void;
  
  // Tab actions
  addTab: (workspaceId: string, tab: Partial<TabState>) => string;
  updateTab: (workspaceId: string, tabId: string, updates: Partial<TabState>) => void;
  closeTab: (workspaceId: string, tabId: string) => void;
  setActiveTab: (workspaceId: string, tabId: string) => void;
  reorderTabs: (workspaceId: string, newOrder: string[]) => void;
  
  // Tab state actions
  updateTabUI: (workspaceId: string, tabId: string, ui: Partial<TabState['ui']>) => void;
  setTabDirty: (workspaceId: string, tabId: string, isDirty: boolean) => void;
  setTabLoading: (workspaceId: string, tabId: string, isLoading: boolean) => void;
  
  // Getters
  getActiveWorkspace: () => WorkspaceState | null;
  getActiveTab: () => TabState | null;
  getTabsByConnection: (connectionId: string) => TabState[];
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    immer((set, get) => ({
      workspaces: new Map(),
      activeWorkspaceId: null,
      
      createWorkspace: (name) => {
        const id = crypto.randomUUID();
        const now = new Date();
        
        set((state) => {
          state.workspaces.set(id, {
            id,
            name,
            connectionIds: [],
            activeConnectionId: null,
            tabs: new Map(),
            tabOrder: [],
            activeTabId: null,
            settings: {
              defaultPageSize: 100,
              autoSave: true,
              confirmOnClose: true,
            },
            createdAt: now,
            updatedAt: now,
          });
          state.activeWorkspaceId = id;
        });
        
        return id;
      },
      
      addTab: (workspaceId, tab) => {
        const tabId = crypto.randomUUID();
        const now = new Date();
        
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return;
          
          // Ensure tab has a connection
          const connectionId = tab.connectionId || workspace.activeConnectionId;
          if (!connectionId) {
            throw new Error('Tab must have a connection');
          }
          
          const newTab: TabState = {
            id: tabId,
            type: tab.type || 'query',
            connectionId,
            title: tab.title || 'New Query',
            payload: tab.payload || {},
            ui: {
              scrollTop: 0,
              scrollLeft: 0,
              columnWidths: {},
              selectedRows: new Set(),
              expandedRows: new Set(),
              ...tab.ui,
            },
            isDirty: false,
            isLoading: false,
            createdAt: now,
            lastAccessedAt: now,
            ...tab,
          };
          
          workspace.tabs.set(tabId, newTab);
          workspace.tabOrder.push(tabId);
          workspace.activeTabId = tabId;
          
          // Sync active connection with tab's connection
          workspace.activeConnectionId = connectionId;
        });
        
        return tabId;
      },
      
      setActiveTab: (workspaceId, tabId) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);
          
          if (workspace && tab) {
            workspace.activeTabId = tabId;
            workspace.activeConnectionId = tab.connectionId;
            tab.lastAccessedAt = new Date();
          }
        });
      },
      
      // ... other actions
      
      getActiveWorkspace: () => {
        const state = get();
        return state.activeWorkspaceId 
          ? state.workspaces.get(state.activeWorkspaceId) || null
          : null;
      },
      
      getActiveTab: () => {
        const workspace = get().getActiveWorkspace();
        return workspace?.activeTabId
          ? workspace.tabs.get(workspace.activeTabId) || null
          : null;
      },
    })),
    {
      name: 'workspace-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Custom serialization to handle Maps and Sets
        workspaces: Array.from(state.workspaces.entries()).map(([id, ws]) => ({
          ...ws,
          tabs: Array.from(ws.tabs.entries()).map(([tabId, tab]) => ({
            ...tab,
            ui: {
              ...tab.ui,
              selectedRows: Array.from(tab.ui.selectedRows),
              expandedRows: Array.from(tab.ui.expandedRows),
            },
          })),
        })),
        activeWorkspaceId: state.activeWorkspaceId,
      }),
      onRehydrateStorage: () => (state) => {
        // Restore Maps and Sets from arrays
        if (state) {
          const workspaces = new Map();
          state.workspaces.forEach((ws: any) => {
            const tabs = new Map();
            ws.tabs.forEach((tab: any) => {
              tabs.set(tab.id, {
                ...tab,
                ui: {
                  ...tab.ui,
                  selectedRows: new Set(tab.ui.selectedRows),
                  expandedRows: new Set(tab.ui.expandedRows),
                },
                createdAt: new Date(tab.createdAt),
                lastAccessedAt: new Date(tab.lastAccessedAt),
              });
            });
            
            workspaces.set(ws.id, {
              ...ws,
              tabs,
              createdAt: new Date(ws.createdAt),
              updatedAt: new Date(ws.updatedAt),
            });
          });
          
          state.workspaces = workspaces;
        }
      },
    }
  )
);
```

### 2. Implement Cache Layer
```typescript
// src/services/cacheService.ts
import Dexie, { Table } from 'dexie';
import { LRUCache } from 'lru-cache';

// IndexedDB for persistent cache
class CacheDatabase extends Dexie {
  schemas!: Table<SchemaCache>;
  queries!: Table<QueryCache>;
  tables!: Table<TableCache>;
  
  constructor() {
    super('DevDBCache');
    
    this.version(1).stores({
      schemas: 'id, connectionId, timestamp',
      queries: 'id, hash, connectionId, timestamp',
      tables: 'id, connectionId, schema, table, timestamp',
    });
  }
}

interface SchemaCache {
  id: string;
  connectionId: string;
  data: DatabaseSchema;
  timestamp: number;
}

interface QueryCache {
  id: string;
  hash: string;
  connectionId: string;
  sql: string;
  result: QueryResult;
  timestamp: number;
}

interface TableCache {
  id: string;
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnMeta[];
  data: any[];
  timestamp: number;
}

// In-memory LRU cache for hot data
class CacheService {
  private db: CacheDatabase;
  private memoryCache: LRUCache<string, any>;
  private ttl: Record<string, number> = {
    schema: 10 * 60 * 1000,     // 10 minutes
    table: 5 * 60 * 1000,        // 5 minutes
    query: 2 * 60 * 1000,        // 2 minutes
  };
  
  constructor() {
    this.db = new CacheDatabase();
    this.memoryCache = new LRUCache({
      max: 100,  // Max 100 items in memory
      ttl: 1000 * 60 * 2,  // 2 minute TTL
      updateAgeOnGet: true,
    });
  }
  
  // Schema caching
  async getSchema(connectionId: string): Promise<DatabaseSchema | null> {
    const key = `schema:${connectionId}`;
    
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }
    
    // Check IndexedDB
    const cached = await this.db.schemas
      .where('connectionId')
      .equals(connectionId)
      .first();
    
    if (cached && Date.now() - cached.timestamp < this.ttl.schema) {
      this.memoryCache.set(key, cached.data);
      return cached.data;
    }
    
    return null;
  }
  
  async setSchema(connectionId: string, schema: DatabaseSchema): Promise<void> {
    const key = `schema:${connectionId}`;
    const id = crypto.randomUUID();
    
    // Update both caches
    this.memoryCache.set(key, schema);
    
    await this.db.schemas.put({
      id,
      connectionId,
      data: schema,
      timestamp: Date.now(),
    });
  }
  
  // Query result caching
  async getQueryResult(connectionId: string, sql: string): Promise<QueryResult | null> {
    const hash = await this.hashQuery(sql);
    const key = `query:${connectionId}:${hash}`;
    
    // Check memory cache
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }
    
    // Check IndexedDB
    const cached = await this.db.queries
      .where('hash')
      .equals(hash)
      .and(q => q.connectionId === connectionId)
      .first();
    
    if (cached && Date.now() - cached.timestamp < this.ttl.query) {
      this.memoryCache.set(key, cached.result);
      return cached.result;
    }
    
    return null;
  }
  
  async setQueryResult(
    connectionId: string,
    sql: string,
    result: QueryResult
  ): Promise<void> {
    const hash = await this.hashQuery(sql);
    const key = `query:${connectionId}:${hash}`;
    const id = crypto.randomUUID();
    
    this.memoryCache.set(key, result);
    
    await this.db.queries.put({
      id,
      hash,
      connectionId,
      sql,
      result,
      timestamp: Date.now(),
    });
  }
  
  // Invalidation
  async invalidateConnection(connectionId: string): Promise<void> {
    // Clear memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(connectionId)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Clear IndexedDB
    await Promise.all([
      this.db.schemas.where('connectionId').equals(connectionId).delete(),
      this.db.queries.where('connectionId').equals(connectionId).delete(),
      this.db.tables.where('connectionId').equals(connectionId).delete(),
    ]);
  }
  
  async invalidateTable(connectionId: string, schema: string, table: string): Promise<void> {
    const key = `table:${connectionId}:${schema}.${table}`;
    this.memoryCache.delete(key);
    
    await this.db.tables
      .where('connectionId').equals(connectionId)
      .and(t => t.schema === schema && t.table === table)
      .delete();
  }
  
  private async hashQuery(sql: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(sql);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export const cacheService = new CacheService();
```

### 3. Create Data Fetching Hooks
```typescript
// src/hooks/useQueryData.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/tauri';
import { cacheService } from '@/services/cacheService';

export function useQueryData(
  connectionId: string,
  sql: string,
  options?: QueryOptions
) {
  return useQuery({
    queryKey: ['query', connectionId, sql],
    queryFn: async () => {
      // Check cache first
      const cached = await cacheService.getQueryResult(connectionId, sql);
      if (cached) return cached;
      
      // Start paginated query
      const cursor = await invoke('db_query_begin', {
        connectionId,
        sql,
        options: {
          pageSize: options?.pageSize || 1000,
          ...options,
        },
      });
      
      // Cache the result
      await cacheService.setQueryResult(connectionId, sql, cursor);
      
      return cursor;
    },
    staleTime: 2 * 60 * 1000,  // 2 minutes
    cacheTime: 5 * 60 * 1000,  // 5 minutes
  });
}

export function useFetchMore(
  connectionId: string,
  cursorId: string | undefined
) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      if (!cursorId) throw new Error('No cursor ID');
      
      return await invoke('db_query_fetch', {
        connectionId,
        cursorId,
      });
    },
    onSuccess: (data) => {
      // Update the query cache with new rows
      queryClient.setQueryData(
        ['query', connectionId],
        (old: any) => ({
          ...old,
          rows: [...(old?.rows || []), ...data.rows],
          isComplete: data.isComplete,
        })
      );
    },
  });
}

// src/hooks/useTableData.ts
export function useTableData(
  connectionId: string,
  schema: string,
  table: string,
  filters?: ColumnFilter[],
  sort?: SortConfig
) {
  const queryKey = ['table', connectionId, schema, table, filters, sort];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      // Build query with filters and sort
      const sql = buildTableQuery(schema, table, filters, sort);
      
      const result = await invoke('db_query_begin', {
        connectionId,
        sql,
        options: { pageSize: 100 },
      });
      
      return result;
    },
    staleTime: 1 * 60 * 1000,
  });
}

// src/hooks/useOptimisticUpdate.ts
export function useOptimisticUpdate(
  connectionId: string,
  table: string
) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ rowId, column, value }: UpdateParams) => {
      return await invoke('db_update_cell', {
        connectionId,
        table,
        rowId,
        column,
        value,
      });
    },
    onMutate: async ({ rowId, column, value }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries(['table', connectionId]);
      
      // Snapshot previous value
      const previous = queryClient.getQueryData(['table', connectionId]);
      
      // Optimistically update
      queryClient.setQueryData(['table', connectionId], (old: any) => {
        const newRows = [...old.rows];
        const rowIndex = newRows.findIndex(r => r.id === rowId);
        if (rowIndex >= 0) {
          newRows[rowIndex] = {
            ...newRows[rowIndex],
            [column]: value,
          };
        }
        return { ...old, rows: newRows };
      });
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['table', connectionId], context.previous);
      }
    },
    onSettled: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries(['table', connectionId]);
    },
  });
}
```

### 4. Update Tab Components
```typescript
// src/components/workspace/TabBar.tsx
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useConnectionStore } from '@/stores/connectionStore';

export function TabBar() {
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  const { setActiveTab, closeTab, reorderTabs } = useWorkspaceStore();
  const connections = useConnectionStore(s => s.connections);
  
  if (!workspace) return null;
  
  // DnD Kit for tab reordering
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.id !== over?.id) {
      const oldIndex = workspace.tabOrder.indexOf(active.id as string);
      const newIndex = workspace.tabOrder.indexOf(over?.id as string);
      
      const newOrder = arrayMove(workspace.tabOrder, oldIndex, newIndex);
      reorderTabs(workspace.id, newOrder);
    }
  };
  
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={workspace.tabOrder}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-center border-b bg-background">
          {workspace.tabOrder.map(tabId => {
            const tab = workspace.tabs.get(tabId);
            if (!tab) return null;
            
            const connection = connections.get(tab.connectionId);
            const isActive = workspace.activeTabId === tabId;
            
            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                connection={connection}
                isActive={isActive}
                onActivate={() => setActiveTab(workspace.id, tab.id)}
                onClose={() => closeTab(workspace.id, tab.id)}
              />
            );
          })}
          
          <NewTabButton workspaceId={workspace.id} />
        </div>
      </SortableContext>
    </DndContext>
  );
}

// src/components/workspace/TabContent.tsx
export function TabContent() {
  const tab = useWorkspaceStore(s => s.getActiveTab());
  
  if (!tab) {
    return <EmptyState />;
  }
  
  // Render based on tab type
  switch (tab.type) {
    case 'query':
      return (
        <QueryTab
          tab={tab}
          connectionId={tab.connectionId}
        />
      );
    
    case 'table':
      return (
        <TableTab
          tab={tab}
          connectionId={tab.connectionId}
          schema={tab.payload.schema!}
          table={tab.payload.tableName!}
        />
      );
    
    case 'schema':
      return (
        <SchemaTab
          tab={tab}
          connectionId={tab.connectionId}
        />
      );
    
    case 'result':
      return (
        <ResultTab
          tab={tab}
          resultId={tab.payload.resultId!}
        />
      );
    
    default:
      return null;
  }
}
```

## Migration Strategy

1. **Phase 1**: Implement new stores alongside existing
   - Create new workspaceStore with tab management
   - Implement cache service
   - Add new hooks

2. **Phase 2**: Migrate components gradually
   - Update TabBar to use new store
   - Update QueryEditor to use new hooks
   - Update DataViewer for caching

3. **Phase 3**: Data migration
   - Migrate existing workspace data
   - Migrate tab state if any exists
   - Clean up old stores

## Files to Create/Modify
- Update `src/stores/workspaceStore.ts` - Complete refactor with tab management
- Create `src/services/cacheService.ts` - Frontend cache implementation
- Create `src/hooks/useQueryData.ts` - Query data fetching hook
- Create `src/hooks/useTableData.ts` - Table data hook
- Create `src/hooks/useOptimisticUpdate.ts` - Optimistic updates
- Update `src/components/workspace/TabBar.tsx` - New tab bar component
- Update `src/components/workspace/TabContent.tsx` - Tab content rendering
- Create `src/types/workspace.ts` - TypeScript types for workspace/tabs
- Install frontend dependencies: `pnpm add dexie lru-cache`

## Testing Requirements
1. **Unit Tests**
   - Test store actions
   - Test cache service
   - Test hooks

2. **Integration Tests**
   - Test tab lifecycle
   - Test state persistence
   - Test cache invalidation

3. **E2E Tests**
   - Test full workspace flow
   - Test refresh persistence
   - Test tab switching

## Success Metrics
- Zero state loss on refresh
- Tab switching < 50ms
- Cache hit rate > 80%
- Memory usage < 200MB
- Smooth tab reordering

## Implementation Status ✅ COMPLETED

### What Was Implemented
1. **Workspace Store with Tab Management** ✅
   - Complete workspace store implementation in `/src/stores/workspaceStore.ts`
   - Tab lifecycle management (add, close, update, reorder)
   - Connection binding for each tab
   - State persistence with localStorage
   - Proper serialization/deserialization for Maps and Sets

2. **Cache Service** ✅ 
   - IndexedDB-based persistent cache in `/src/services/cacheService.ts`
   - LRU in-memory cache for hot data
   - Schema, table data, and query result caching
   - Connection-level cache invalidation
   - TTL-based cache expiration

3. **Data Fetching Hooks** ✅
   - `/src/hooks/useQueryData.ts` - SQL query execution with caching
   - `/src/hooks/useTableData.ts` - Table data fetching with filtering/sorting
   - `/src/hooks/useDatabase.ts` - Database schema and metadata
   - Optimistic updates for cell editing
   - React Query integration with cache service

4. **Tab Components** ✅
   - `/src/components/workspace/TabBar.tsx` - Drag-and-drop tab reordering
   - `/src/components/workspace/TabContent.tsx` - Tab content routing
   - `/src/components/workspace/tabs/QueryTab.tsx` - SQL query editor
   - `/src/components/workspace/tabs/TableTab.tsx` - Table data browser
   - `/src/components/workspace/tabs/SchemaTab.tsx` - Database schema browser
   - `/src/components/workspace/tabs/ResultTab.tsx` - Query result display
   - `/src/components/workspace/EmptyState.tsx` - No tab state
   - `/src/components/workspace/NewTabButton.tsx` - Tab creation

5. **TypeScript Types** ✅
   - `/src/types/workspace.ts` - Complete workspace and tab type definitions
   - Proper serializable types for persistence
   - Tab-specific payload types for different tab types

### Dependencies Installed ✅
- `dexie` - IndexedDB wrapper for persistent cache
- `lru-cache` - In-memory LRU cache
- All existing dependencies maintained

### Technical Achievements ✅
- **Zero state loss on refresh** - Complete persistence implementation
- **Workspace-scoped tabs** - Each tab bound to connection
- **Performance optimizations** - Multi-level caching (memory + IndexedDB)
- **Optimistic updates** - Immediate UI feedback for edits
- **Type safety** - Comprehensive TypeScript types
- **Clean separation** - Separate stores for workspace vs connection management

## Notes
- This refactor enables proper workspace-scoped architecture
- Backend database type converters were also implemented as prerequisite
- Frontend implementation is ready for integration with backend
- All acceptance criteria have been met
- Task is ready for QA and integration testing