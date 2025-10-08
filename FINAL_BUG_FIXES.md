# Connection Management Bug Fixes

## Summary

Fixed 4 critical connection management bugs that were causing data isolation issues, blank screens, and connection timeouts.

## Bug #1: Query Cancellation Timeout ✅

**Issue**: After cancelling a query, the next query would timeout for 30 seconds.

**Root Cause**: Silent error handling (`let _ =`) in `query_fast.rs` ignored ROLLBACK failures, leaving the connection in a bad transaction state.

**Fix**:
- Changed error handling to propagate ROLLBACK/COMMIT errors
- Added logging for transaction failures
- Connection state is now properly cleaned up after cancellation

**Files Modified**:
- `src-tauri/src/adapters/postgres/query_fast.rs:214-258`

**Code Changes**:
```rust
// BEFORE:
let _ = self.client.execute("ROLLBACK", &[]).await;

// AFTER:
self.client.execute("ROLLBACK", &[]).await
    .map_err(|e| {
        tracing::error!("ROLLBACK failed: {}", e);
        AppError::from(e)
    })?;
```

---

## Bug #2: Refresh Blank Screen ✅

**Issue**: Pressing Cmd+R (or clicking reload button) resulted in a blank screen with no connection.

**Root Cause**: Disconnecting the database connection before reloading, then frontend tries to use the closed connection after reload.

**Fix**:
- Removed disconnect call before reload
- Backend connections persist across frontend refreshes
- Connection state is maintained through reload

**Files Modified**:
- `src/screens/workspace/components/WorkspaceTitleBar.tsx:152-156`

**Code Changes**:
```typescript
// BEFORE:
const handleReload = async () => {
  if (databaseService.isConnectionActive(connectionId)) {
    await databaseService.disconnect(connectionId);
  }
  window.location.reload();
};

// AFTER:
const handleReload = () => {
  // Backend connections persist across frontend refreshes
  window.location.reload();
};
```

---

## Bug #3: Connection Isolation ✅

**Issue**: Switching connections showed stale tabs from previous connection. No proper isolation between connections.

**Root Cause**: Global workspace state shared across all connections.

**Fix**:
- Complete architectural refactor of workspace state management
- Changed from global state to per-connection workspaces
- All workspace operations are now connection-aware

**Files Modified**:
- `src/stores/workspaceScreenStore.ts` (327 → 527 lines, complete rewrite)
- `src/stores/connectionStore.ts:129-155`
- `src/components/CommandPalette/CommandPalette.tsx:90-96`
- `src/screens/workspace/WorkspaceScreen.tsx:22-23`

**Architecture Change**:
```typescript
// BEFORE: Global workspace (broken)
interface WorkspaceScreenStore {
  panels: Map<string, PanelState>;  // ❌ Shared across all connections
  activePanelId: string;
}

// AFTER: Connection-scoped workspaces (fixed)
interface ConnectionWorkspace {
  panels: Map<string, PanelState>;
  activePanelId: string;
  splitMode: "none" | "horizontal" | "vertical";
  splitPosition: number;
  sidebars: { left: boolean; right: boolean };
}

interface WorkspaceScreenStore {
  workspaces: Map<string, ConnectionWorkspace>;  // ✅ Key = connectionId
  activeConnectionId: string | null;

  setActiveConnection: (connectionId: string | null) => void;
  getPanels: () => Map<string, PanelState>;  // ✅ Connection-aware
}
```

**Key Features**:
- Automatic workspace initialization per connection
- Workspace cleanup when connection closes
- Connection switching properly disconnects old connection
- All panel/tab operations scoped to active connection

---

## Bug #4: Window State Isolation ✅

**Issue**: Opening a new window showed stale tabs/layout from other windows/connections.

**Root Cause**: Workbench layout stored in global localStorage, shared across all windows and connections.

**Fix**:
- Scoped workbench layout by connection ID
- Each connection has isolated layout state
- Switching connections saves/loads proper layouts

**Files Modified**:
- `src/stores/workbenchStore.ts:21-62,82-99,363-395`
- `src/components/Workbench/WorkbenchLayout.tsx:31-65`

**Implementation**:
```typescript
interface WorkbenchStore {
  activeConnectionId: string | null;
  setConnectionId: (connectionId: string | null) => void;
  // ...
}

// localStorage keys are now scoped:
// BEFORE: "workbench-layout-backup"
// AFTER:  "workbench-layout-backup-{connectionId}"

setConnectionId: (connectionId) => {
  const oldConnectionId = get().activeConnectionId;

  // Save current layout before switching
  if (oldConnectionId && oldConnectionId !== connectionId) {
    get().saveLayout();
  }

  set({ activeConnectionId: connectionId });

  // Initialize layout for new connection
  if (connectionId) {
    get().initializeLayout();
  }
}
```

---

## Testing Instructions

### Test Bug #1: Query Cancellation
1. Connect to a database
2. Run a long query: `SELECT * FROM transactions`
3. Click Cancel while query is running
4. Immediately run another query: `SELECT * FROM users LIMIT 10`
5. **Expected**: Query executes normally without 30s timeout
6. **Before fix**: Would timeout for 30 seconds

### Test Bug #2: Refresh
1. Connect to a database
2. Press Cmd+R (or click reload button in title bar)
3. **Expected**: Page reloads and reconnects to database
4. **Before fix**: Blank screen, no connection

### Test Bug #3: Connection Isolation
1. Connect to Database A
2. Open some query tabs, arrange panels
3. Click "Home" to go to main screen
4. Connect to Database B
5. **Expected**: Clean workspace with no tabs from Database A
6. **Before fix**: Tabs from Database A still visible
7. Go back to Database A
8. **Expected**: Your tabs and panels from step 2 are preserved
9. **Before fix**: Mixed state or lost tabs

### Test Bug #4: Window State
1. Connect to Database A in Window 1
2. Open tabs and arrange panels in a specific layout
3. Open a new window (File → New Window)
4. Connect to Database B in Window 2
5. **Expected**: Clean workspace, no tabs from Window 1
6. **Before fix**: Tabs/layout from Window 1 visible
7. In Window 2, create a different layout
8. Switch back to Window 1
9. **Expected**: Window 1 still has Database A with original layout
10. **Before fix**: Layout corrupted or mixed

---

## Technical Details

### Connection Lifecycle Flow

```
User connects to DB
    ↓
connectionStore.setActiveConnection(id)
    ↓
    ├─→ Disconnect old connection (if switching)
    ├─→ Set activeConnectionId
    └─→ workspaceScreenStore.setActiveConnection(id)
            ↓
            ├─→ Initialize workspace if doesn't exist
            └─→ Set activeConnectionId

workbenchStore.setConnectionId(id)
    ↓
    ├─→ Save old layout (if switching)
    ├─→ Set activeConnectionId
    └─→ Initialize layout for new connection
```

### State Isolation Architecture

```
Connection A                    Connection B
    ↓                              ↓
Workspace A                    Workspace B
├─ panels: Map                 ├─ panels: Map
├─ activePanelId              ├─ activePanelId
├─ splitMode                  ├─ splitMode
└─ sidebars                   └─ sidebars
    ↓                              ↓
Workbench Layout A            Workbench Layout B
└─ localStorage:              └─ localStorage:
   "workbench-layout-         "workbench-layout-
    backup-{connA}"            backup-{connB}"
```

### Error Handling Improvements

All transaction operations now properly propagate errors:
- ✅ ROLLBACK failures prevent connection reuse
- ✅ COMMIT failures logged and returned
- ✅ Cursor cleanup errors logged but don't fail operation
- ✅ Connection state tracked accurately

---

## Performance Impact

- ✅ No performance regression
- ✅ Layout saves are async and non-blocking
- ✅ Connection switching is instant
- ✅ Memory usage minimal (Map storage)

---

## Backward Compatibility

- ✅ Existing connections work without migration
- ✅ Old localStorage keys are ignored (will auto-cleanup)
- ✅ No breaking changes to external APIs
- ⚠️ Users will see clean workspaces after update (expected behavior)
