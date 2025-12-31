# Switch Database/Schema Commands Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan.

**Goal:** Add Raycast-style nested commands to switch database, schema, or open connections from the command palette.

**Architecture:** Extend command palette with nested mode state. Commands trigger nested views instead of direct actions. Context-aware command visibility based on current page (home vs workspace).

---

## State Model

The command palette gains a nested mode concept:

```typescript
interface CommandPaletteState {
  isOpen: boolean;
  query: string;

  // New nested state
  nestedMode: NestedMode | null;  // null = main view
}

type NestedMode =
  | { type: 'switch-database' }
  | { type: 'switch-schema' }
  | { type: 'open-connection' };  // for home page
```

**Behavior:**
- `nestedMode === null` → show unified items (current behavior)
- `nestedMode` set → show the nested list (databases/schemas/profiles)
- Selecting a nested command sets `nestedMode` and clears `query`
- Backspace on empty query or "← Back" resets `nestedMode` to null
- ESC always closes the palette entirely

---

## Commands

| Command ID | Label | Context | Nested Mode |
|------------|-------|---------|-------------|
| `workspace.switchDatabase` | Switch Database | Workspace only | `switch-database` |
| `workspace.switchSchema` | Switch Schema | Workspace only | `switch-schema` |
| `connection.open` | Open Connection | Home page only | `open-connection` |

**Context detection:**
- Check `useWorkspaceSelectionStore.connectionId` - if set, we're in a workspace
- Commands filter based on this context in `useUnifiedItems`

---

## Nested List Rendering

When `nestedMode` is set, the palette renders:

```
┌─────────────────────────────────────────┐
│ 🔍 [Search databases...]                │
├─────────────────────────────────────────┤
│ ← Back                                  │
│─────────────────────────────────────────│
│ ✓ todoapp                          ●    │  ← current + has profile
│   analytics                        ●    │  ← has saved profile
│   postgres                              │  ← no profile
│   template1                             │
└─────────────────────────────────────────┘
```

**Elements:**
- Input placeholder changes based on mode
- "← Back" as first item in list (keyboard accessible)
- Checkmark on currently active item
- Database items: dot indicator for saved profile
- Schema items: star for default schema
- Fuzzy search filters the list

**Data sources:**
- `switch-database`: `databaseService.listDatabases(connectionId)`
- `switch-schema`: `databaseService.listSchemas(connectionId, database)`
- `open-connection`: `useConnectionStore.connections`

---

## Interactions

**Selection actions:**

| Nested Mode | On Select | Effect |
|-------------|-----------|--------|
| `switch-database` | Click/Enter | Switch database, update store, close palette |
| `switch-schema` | Click/Enter | Switch schema, update store, close palette |
| `open-connection` | Click/Enter | Open workspace in new window, close palette |

**Navigation:**

| Action | Effect |
|--------|--------|
| Backspace on empty input | Reset to main view |
| Click "← Back" | Reset to main view |
| ESC | Close palette entirely |

**Error handling:**
- Failed to load → show error message with retry
- Loading → show spinner in list area

---

## Files to Modify

1. `src/stores/ui/commandPaletteStore.ts` - Add `nestedMode` state
2. `src/data/defaultCommands.ts` - Add new commands
3. `src/components/CommandPalette/CommandPalette.tsx` - Handle nested rendering
4. `src/components/CommandPalette/useCommandPaletteQueries.ts` - Context-aware filtering
5. New: `src/components/CommandPalette/NestedDatabaseList.tsx`
6. New: `src/components/CommandPalette/NestedSchemaList.tsx`
7. New: `src/components/CommandPalette/NestedConnectionList.tsx`
