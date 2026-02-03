# AI Agent Commands Design

**Date:** 2026-02-03
**Status:** Approved
**Author:** Claude + User

## Overview

Redesign the AI agent command system to provide safe, useful database interactions through Query Pilot. The agent can execute queries, manage tabs, and stage CRUD changes - but cannot commit changes or access the filesystem.

## Command Schema

### Query & Tab Commands

```typescript
// Run query in new tab with auto-execute
"query.run": {
  connectionId: string;      // Required (from @mention or explicit)
  query: string;             // The SQL/MongoDB/Redis query
  title?: string;            // Tab title (default: first 30 chars of query)
  database?: string;         // For multi-db connections
  schema?: string;           // For PostgreSQL
}

// Create tab (FIX - currently broken)
"tab.create": {
  connectionId: string;      // Required
  type: "query" | "table";   // Tab type
  title?: string;
  content?: string;          // Initial SQL content
}

// Update tab content (FIX - currently broken)
"tab.update": {
  tabId?: string;            // Optional, defaults to active tab
  content?: string;          // New SQL content
  title?: string;            // New title
  mode?: "replace" | "append" | "prepend";  // Default: replace
}

// Focus/switch to tab (NEW)
"tab.focus": {
  tabId: string;             // Required
}
```

### CRUD Commands

```typescript
// Stage change (existing - keep as-is)
"crud.stage": {
  connectionId: string;
  operation: "insert" | "update" | "delete";
  table: string;
  database?: string;
  schema?: string;
  document?: Record<string, unknown>;    // For insert
  filter?: Record<string, unknown>;      // For update/delete
  update?: Record<string, unknown>;      // For update
  description?: string;                  // Audit trail
}

// Unstage changes (NEW)
"crud.unstage": {
  scope: "id" | "table" | "all";
  commandId?: string;        // When scope = "id"
  table?: string;            // When scope = "table"
  connectionId?: string;     // Filter by connection
}
```

## UI Rendering

### Inline Query Blocks

SQL queries render as clickable blocks with Run button:

```
┌──────────────────────────────────────────────────────┐
│ ```sql                                        @conn1 │
│ SELECT * FROM users WHERE status = 'active'         │
│ LIMIT 100;                                          │
│                                          [▶ Run]    │
└──────────────────────────────────────────────────────┘
```

**Behavior:**
- Connection badge shown from @ mention context
- Hover: highlight border, tooltip "Run in new tab"
- Click Run: Creates tab → executes query → shows results
- No connection context: Show dropdown to pick connection

### CRUD Command Cards

Staging operations use expandable cards:

```
┌─ Stage Insert ──────────────────────── @public.users ┐
│                                                      │
│  INSERT { "name": "John", "email": "john@test.com" } │
│                                                      │
│  ⚠ Requires approval                                 │
│                                    [Cancel] [Stage]  │
└──────────────────────────────────────────────────────┘
```

**States:**
| State | Appearance |
|-------|------------|
| Pending | Default, shows Stage/Cancel buttons |
| Staged | Green border, "✓ Staged" badge, shows [Unstage] |
| Rejected | Gray, struck-through |
| Error | Red border, error message |

### Click-to-Focus

References to tabs or staged changes are clickable links that focus the relevant UI element.

## Implementation Plan

### Priority 1: Fix Broken Commands

1. **`tab.create`** - Debug why tab doesn't appear after execution
   - Check `useWorkspaceScreenStore.addTab()` flow
   - Verify correct `panelId` usage

2. **`tab.update`** - Debug why content doesn't update
   - Check `updateTab()` → CodeMirror sync
   - Verify payload structure

### Priority 2: New Commands

| Command | Location | Implementation |
|---------|----------|----------------|
| `query.run` | `aiCommandExecutor.ts` | Create tab + trigger query execution |
| `tab.focus` | `aiCommandExecutor.ts` | Call `setActiveTab()` |
| `crud.unstage` | `aiCommandExecutor.ts` | Call `crudStore.unstageCommand()` |

### Priority 3: UI Changes

| Change | Files |
|--------|-------|
| Inline query blocks with Run button | New `QueryBlock.tsx` component |
| Connection badge on queries | `QueryBlock.tsx` |
| Click-to-focus links | `MessageBubble.tsx` |
| Staged state on CRUD cards | `CommandCard.tsx` |

### Priority 4: Parser Updates

Update `aiCommandParser.ts`:
- Add new command definitions to `AI_COMMAND_DEFS`
- Add validation rules for new params
- Update `getCommandDescription()` for UI labels

### Priority 5: System Prompt Updates

Update `SYSTEM_INSTRUCTIONS` in `commands.rs` to document:
- Available commands and their formats
- Forbidden actions (commit, file ops, direct DB writes)
- Command XML format

## Safety Model

### Allowed Actions

| Action | Approval | Reason |
|--------|----------|--------|
| `query.run` | Auto | Read-only query execution |
| `tab.create` | Auto | UI operation only |
| `tab.update` | Auto | UI operation only |
| `tab.focus` | Auto | UI operation only |
| `crud.stage` | Approve | User reviews before commit |
| `crud.unstage` | Auto | Safe, removes pending work |

### Forbidden Actions

| Action | Reason |
|--------|--------|
| `crud.commit` | User-only action, never allow AI to commit |
| Bash | No shell access |
| Write/Edit | No file modifications |
| Glob/Grep/Read | No filesystem access |
| ToolSearch | No tool discovery |
| Direct DB writes | Must use crud.stage workflow |

## Command Format

AI outputs commands in XML format:

```xml
<command name="query.run">{"connectionId":"conn1","query":"SELECT * FROM users"}</command>

<command name="crud.stage">{
  "connectionId": "conn1",
  "operation": "insert",
  "table": "users",
  "document": {"name": "John", "email": "john@test.com"},
  "description": "Add new user John"
}</command>
```

## Success Criteria

1. All tab commands work reliably (create, update, focus)
2. Query blocks render inline with Run button
3. CRUD staging shows proper approval flow
4. Unstage command removes pending changes
5. AI cannot commit or access filesystem
6. Connection context flows from @ mentions
