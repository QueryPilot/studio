# P0-003: Fix Workspace-Scoped Tabs

## Priority
P0 - Critical Foundation

## Dependencies
- P0-001: Connection Health Monitoring (for connection status in tabs)

## Estimated Effort
6-8 hours

## Problem Statement
Current tab implementation is global rather than workspace-scoped. Tabs don't maintain connection context, causing confusion when switching between workspaces. Tab state is lost on refresh.

## Acceptance Criteria
- [ ] Each workspace has its own isolated set of tabs
- [ ] Each tab is bound to a specific connection
- [ ] Tab state persists across sessions (query, scroll position, filters)
- [ ] Switching workspaces shows correct tabs for that workspace
- [ ] Active connection syncs with active tab's connection
- [ ] Clear visual indication of tab's connection

## Implementation Notes

### State Structure (Zustand)
```typescript
// src/stores/workspaceStore.ts
interface TabState {
  id: string;
  type: 'query' | 'table' | 'result';
  connectionId: string;  // REQUIRED: Each tab bound to connection
  title: string;
  payload: {
    sql?: string;
    tableName?: string;
    filters?: Record<string, any>;
    sort?: SortConfig;
    cursorId?: string;  // For paginated results
  };
  ui: {
    scrollOffset: number;
    columnWidths: Record<string, number>;
    selectedRows: Set<string>;
  };
  isDirty: boolean;
  createdAt: Date;
  lastAccessedAt: Date;
}

interface WorkspaceState {
  id: string;
  name: string;
  tabs: Map<string, TabState>;
  activeTabId: string | null;
  activeConnectionId: string | null;  // Synced with active tab
  tabOrder: string[];  // For drag-and-drop reordering
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: new Map<string, WorkspaceState>(),
      activeWorkspaceId: null,
      
      addTab: (workspaceId: string, tab: Partial<TabState>) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return state;
          
          const newTab: TabState = {
            id: generateId(),
            type: tab.type || 'query',
            connectionId: tab.connectionId || workspace.activeConnectionId!,
            title: tab.title || 'New Query',
            payload: tab.payload || {},
            ui: {
              scrollOffset: 0,
              columnWidths: {},
              selectedRows: new Set(),
            },
            isDirty: false,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            ...tab,
          };
          
          workspace.tabs.set(newTab.id, newTab);
          workspace.tabOrder.push(newTab.id);
          workspace.activeTabId = newTab.id;
          workspace.activeConnectionId = newTab.connectionId;
          
          return { workspaces: new Map(state.workspaces) };
        });
      },
      
      switchTab: (workspaceId: string, tabId: string) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          const tab = workspace?.tabs.get(tabId);
          
          if (!workspace || !tab) return state;
          
          workspace.activeTabId = tabId;
          workspace.activeConnectionId = tab.connectionId;  // Sync connection
          tab.lastAccessedAt = new Date();
          
          return { workspaces: new Map(state.workspaces) };
        });
      },
      
      closeTab: (workspaceId: string, tabId: string) => {
        set((state) => {
          const workspace = state.workspaces.get(workspaceId);
          if (!workspace) return state;
          
          workspace.tabs.delete(tabId);
          workspace.tabOrder = workspace.tabOrder.filter(id => id !== tabId);
          
          // Select next tab
          if (workspace.activeTabId === tabId) {
            const nextTabId = workspace.tabOrder[workspace.tabOrder.length - 1];
            workspace.activeTabId = nextTabId || null;
            
            const nextTab = workspace.tabs.get(nextTabId);
            workspace.activeConnectionId = nextTab?.connectionId || null;
          }
          
          return { workspaces: new Map(state.workspaces) };
        });
      },
    }),
    {
      name: 'workspace-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workspaces: Array.from(state.workspaces.entries()).map(([id, ws]) => ({
          id,
          name: ws.name,
          tabs: Array.from(ws.tabs.values()).map(tab => ({
            ...tab,
            ui: {
              ...tab.ui,
              selectedRows: Array.from(tab.ui.selectedRows),  // Set to Array for storage
            }
          })),
          activeTabId: ws.activeTabId,
          activeConnectionId: ws.activeConnectionId,
          tabOrder: ws.tabOrder,
        })),
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    }
  )
);
```

### Tab Component
```typescript
// src/components/workspace/TabBar.tsx
export function TabBar() {
  const workspaceId = useWorkspaceStore(s => s.activeWorkspaceId);
  const workspace = useWorkspaceStore(s => s.workspaces.get(workspaceId!));
  const { switchTab, closeTab } = useWorkspaceStore();
  const connectionHealth = useConnectionHealthStore();
  
  if (!workspace) return null;
  
  return (
    <div className="flex items-center border-b">
      {workspace.tabOrder.map(tabId => {
        const tab = workspace.tabs.get(tabId);
        if (!tab) return null;
        
        const connection = connections.get(tab.connectionId);
        const health = connectionHealth.get(tab.connectionId);
        
        return (
          <div
            key={tab.id}
            className={cn(
              "flex items-center gap-2 px-3 py-2 cursor-pointer",
              workspace.activeTabId === tab.id && "bg-accent"
            )}
            onClick={() => switchTab(workspaceId, tab.id)}
          >
            <ConnectionIndicator status={health?.state} />
            <span>{tab.title}</span>
            <span className="text-xs text-muted-foreground">
              ({connection?.name})
            </span>
            {tab.isDirty && <span className="text-orange-500">●</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(workspaceId, tab.id);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => addTab(workspaceId, { type: 'query' })}
        className="p-2"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
```

## Files to Modify
- `src/stores/workspaceStore.ts` - Complete refactor for workspace-scoped tabs
- `src/stores/tabsStore.ts` - Remove or deprecate (replaced by workspace)
- Create `src/components/workspace/TabBar.tsx` - New tab bar component
- `src/components/workspace/WorkspaceView.tsx` - Update to use new tab system
- `src/hooks/useActiveTab.ts` - Helper hook for current tab
- `src/screens/workspace/index.tsx` - Integrate new tab bar

## Testing Requirements
1. **Unit Tests**
   - Test tab CRUD operations
   - Test connection binding
   - Test persistence/hydration

2. **Integration Tests**
   - Create tabs in different workspaces
   - Verify isolation between workspaces
   - Test state persistence across refreshes

3. **Manual Testing**
   - Create multiple workspaces with tabs
   - Switch between workspaces
   - Refresh browser and verify state
   - Drag and drop tab reordering

## Success Metrics
- Zero tab state loss on refresh
- Tab switching < 50ms
- Clear connection context in UI
- No cross-workspace tab leakage

## Notes
- Consider tab groups for organization
- May need tab overflow handling (dropdown for many tabs)
- Future: Share tabs between workspaces via copy/move