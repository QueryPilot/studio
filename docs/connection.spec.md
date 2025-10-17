# Connection Management Refactoring Specification

## Current State Analysis

### Existing Infrastructure
- **Backend Storage**: `src-tauri/src/storage/mod.rs` already implements:
  - `store_connection`, `list_connections`, `delete_connection`, `update_connection` commands
  - JSON file storage in app data directory
  - Currently uses keyring for password encryption (needs modification)
  
- **Frontend Storage**: 
  - Uses IndexedDB via Dexie (needs removal)
  - `connectionStore.ts` manages connections client-side (needs refactoring)

- **Connection Manager**: `src-tauri/src/core/manager.rs` handles active DB connections (keep as-is)

### Issues Identified
1. **HIGH**: Connections stored in frontend IndexedDB instead of backend
2. **HIGH**: No window-specific connection state management  
3. **MEDIUM**: Missing event system for cross-window synchronization
4. **MEDIUM**: No window focus management on connection switch

## Target Architecture

### Core Requirements
1. **Backend-Managed Storage**: All saved connections stored in Rust backend
2. **Window Isolation**: Each window has its own active connection
3. **Window Focus**: Switching connections focuses the target window
4. **Unencrypted Storage**: Initially store passwords unencrypted (prepare for future encryption)

### System Design

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Backend                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │         Storage Module (existing)                │   │
│  │  - JSON file persistence                         │   │
│  │  - CRUD operations for saved connections         │   │
│  │  - Modified to support unencrypted mode          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Window State Manager (new)               │   │
│  │  - HashMap<WindowLabel, ConnectionId>            │   │
│  │  - Track active connection per window            │   │
│  │  - Handle window focus switching                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Event System                             │   │
│  │  - Emit "connections_changed" on CRUD            │   │
│  │  - Emit "active_connection_changed" on switch    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │
                            │ Tauri Commands
                            │
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │         Connection Store (refactored)            │   │
│  │  - No IndexedDB/Dexie                           │   │
│  │  - Fetch from backend via commands              │   │
│  │  - Cache in memory only                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Window Hook (new)                        │   │
│  │  - useWindowConnection()                         │   │
│  │  - Get/set active connection for current window  │   │
│  │  - Listen for cross-window events               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Backend Infrastructure

#### 1.1 Modify Storage Module (`src-tauri/src/storage/mod.rs`)
```rust
// Add unencrypted mode support
pub struct SecureStorage {
    encrypted: bool, // New field
    connections_file: PathBuf,
}

impl SecureStorage {
    pub fn new_unencrypted() -> Self {
        // Initialize with encrypted: false
        // Store passwords directly in JSON
    }
}
```

#### 1.2 Create Window State Manager (`src-tauri/src/window_state.rs`)
```rust
use std::collections::HashMap;
use std::sync::Mutex;

pub struct WindowStateManager {
    states: Mutex<HashMap<String, String>>, // window_label -> connection_id
}

impl WindowStateManager {
    pub fn set_active_connection(&self, window_label: String, connection_id: String);
    pub fn get_active_connection(&self, window_label: &str) -> Option<String>;
    pub fn remove_window(&self, window_label: &str);
    pub fn get_window_for_connection(&self, connection_id: &str) -> Option<String>;
}
```

#### 1.3 Update Main App State (`src-tauri/src/main.rs`)
```rust
pub struct AppState {
    pub storage: Arc<SecureStorage>,
    pub window_states: Arc<WindowStateManager>,
    pub db_manager: Arc<ConnectionManager>, // existing
}
```

### Phase 2: Tauri Commands

#### 2.1 Window-Aware Commands (add to `src-tauri/src/commands.rs`)
```rust
#[tauri::command]
pub async fn set_active_connection(
    window: Window,
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String>;

#[tauri::command]
pub async fn get_active_connection(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<Connection>, String>;

#[tauri::command]
pub async fn switch_to_connection_window(
    connection_id: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String>;
```

#### 2.2 Enhanced Storage Commands (modify existing)
- Add event emission after CRUD operations
- Remove keyring dependency for now
- Return proper Result types

### Phase 3: Frontend Refactoring

#### 3.1 Refactor Connection Store (`src/stores/connectionStore.ts`)
```typescript
interface ConnectionStore {
  connections: Connection[];
  loading: boolean;
  error: string | null;
  
  // Backend operations
  fetchConnections: () => Promise<void>;
  saveConnection: (conn: Connection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  updateConnection: (id: string, conn: Connection) => Promise<void>;
}

// Remove all Dexie/IndexedDB code
// Use invoke() for all operations
```

#### 3.2 Create Window Connection Hook (`src/hooks/useWindowConnection.ts`)
```typescript
export function useWindowConnection() {
  const [activeConnection, setActiveConnection] = useState<Connection | null>(null);
  
  useEffect(() => {
    // Get current window's active connection on mount
    invoke('get_active_connection').then(setActiveConnection);
    
    // Listen for connection changes
    const unlisten = listen('active_connection_changed', (event) => {
      // Update if this window is affected
    });
    
    return () => { unlisten(); };
  }, []);
  
  const switchConnection = async (connectionId: string) => {
    await invoke('set_active_connection', { connectionId });
    // Window will be focused by backend
  };
  
  return { activeConnection, switchConnection };
}
```

#### 3.3 Add Event Listeners (`src/hooks/useConnectionSync.ts`)
```typescript
export function useConnectionSync() {
  const store = useConnectionStore();
  
  useEffect(() => {
    const unlisten = listen('connections_changed', () => {
      store.fetchConnections(); // Re-fetch from backend
    });
    
    return () => { unlisten(); };
  }, []);
}
```

### Phase 4: Migration & Cleanup

#### 4.1 Data Migration
- On first launch, check for existing IndexedDB connections
- Migrate to backend storage
- Clear IndexedDB after successful migration

#### 4.2 Remove Dependencies
- Remove `dexie` from package.json
- Remove IndexedDB-related code
- Clean up unused imports

## Testing Strategy

### Unit Tests
1. Test window state manager operations
2. Test storage module with unencrypted mode
3. Test event emission and reception

### Integration Tests
1. Multi-window connection switching
2. Cross-window synchronization
3. Connection CRUD with event propagation
4. Window focus on connection switch

### Manual Testing Scenarios
1. Open multiple windows, set different connections
2. Delete connection used by another window
3. Update connection, verify all windows see changes
4. Switch to connection in use by another window (should focus that window)

## Security Considerations

### Current (Unencrypted)
- Passwords stored in plain text in JSON file
- File permissions restrict access to current user
- Suitable for development phase only

### Future (Encrypted)
- Use OS keychain via `keyring-rs`
- Store password reference in JSON, actual password in keychain
- Implement master password option
- Add connection string obfuscation

## Performance Considerations

1. **Caching**: Frontend caches connection list in memory
2. **Events**: Use granular events to avoid unnecessary re-fetches
3. **Lazy Loading**: Load connection details only when needed
4. **Debouncing**: Debounce rapid connection switches

## Error Handling

1. **Backend**: All commands return `Result<T, String>`
2. **Frontend**: Display toast notifications for errors
3. **Fallbacks**: Handle missing connections gracefully
4. **Recovery**: Auto-retry failed operations with exponential backoff

## Timeline

- **Week 1**: Backend infrastructure (storage, window state)
- **Week 2**: Tauri commands and event system
- **Week 3**: Frontend refactoring and hooks
- **Week 4**: Testing and migration

## Files to Modify

### Backend
- [ ] `src-tauri/src/storage/mod.rs` - Add unencrypted mode
- [ ] `src-tauri/src/window_state.rs` - Create new file
- [ ] `src-tauri/src/main.rs` - Add window state to AppState
- [ ] `src-tauri/src/commands.rs` - Add window-aware commands

### Frontend
- [ ] `src/stores/connectionStore.ts` - Remove IndexedDB, use backend
- [ ] `src/hooks/useWindowConnection.ts` - Create new hook
- [ ] `src/hooks/useConnectionSync.ts` - Create event listener hook
- [ ] `src/screens/main/ConnectionForm.tsx` - Use new store methods
- [ ] `package.json` - Remove dexie dependency

## Success Criteria

1. ✅ All connections stored in backend JSON file
2. ✅ Each window maintains independent active connection
3. ✅ Switching connections focuses target window
4. ✅ All windows sync when connections change
5. ✅ No IndexedDB/Dexie usage remains
6. ✅ Passwords stored unencrypted (temporary)
7. ✅ Clean error handling throughout