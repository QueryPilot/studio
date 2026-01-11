# Switch Database/Schema Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Raycast-style nested commands to switch database, schema, or open connections from the command palette.

**Architecture:** Extend command palette store with nested mode state. Create separate components for each nested list type. Commands trigger nested mode instead of direct actions. Context-aware command visibility.

**Tech Stack:** React, Zustand, TypeScript, cmdk, React Query

---

## Task Groups (Parallelizable)

| Group | Tasks | Description |
|-------|-------|-------------|
| A | 1-2 | Store updates (nestedMode state) |
| B | 3-4 | New commands registration |
| C | 5-7 | Nested list components |
| D | 8-9 | Main component integration |
| E | 10-11 | Tests |

---

## Group A: Store Updates

### Task 1: Add NestedMode Type

**Files:**
- Modify: `src/stores/ui/commandPaletteStore.ts`

**Step 1: Add the NestedMode type and update state interface**

```typescript
// Add at top of file after imports
export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" };

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  nestedMode: NestedMode | null;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setNestedMode: (mode: NestedMode | null) => void;
  exitNestedMode: () => void;
}
```

**Step 2: Update store implementation**

```typescript
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",
  nestedMode: null,
  openPalette: () => set({ isOpen: true, query: "", nestedMode: null }),
  closePalette: () => set({ isOpen: false, query: "", nestedMode: null }),
  setQuery: (query) => set({ query }),
  setNestedMode: (mode) => set({ nestedMode: mode, query: "" }),
  exitNestedMode: () => set({ nestedMode: null, query: "" }),
}));
```

**Step 3: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i commandPaletteStore || echo "No errors"`

**Step 4: Commit**

```bash
git add src/stores/ui/commandPaletteStore.ts
git commit -m "feat(command-palette): add nestedMode state for nested commands"
```

---

## Group B: Commands Registration

### Task 2: Add Switch Database Command

**Files:**
- Modify: `src/data/defaultCommands.ts`

**Step 1: Add the switch database command**

Add after the existing commands (before the closing bracket of `defaultCommands` array):

```typescript
{
  id: "workspace.switchDatabase",
  label: "Switch Database",
  category: "Workspace",
  description: "Switch to a different database on this server",
  handler: () => {
    const store = useCommandPaletteStore.getState();
    store.setNestedMode({ type: "switch-database" });
  },
},
```

**Step 2: Add the switch schema command**

```typescript
{
  id: "workspace.switchSchema",
  label: "Switch Schema",
  category: "Workspace",
  description: "Switch to a different schema",
  handler: () => {
    const store = useCommandPaletteStore.getState();
    store.setNestedMode({ type: "switch-schema" });
  },
},
```

**Step 3: Add the open connection command (for home page)**

```typescript
{
  id: "connection.open",
  label: "Open Connection",
  category: "Connection",
  description: "Open a saved database connection",
  handler: () => {
    const store = useCommandPaletteStore.getState();
    store.setNestedMode({ type: "open-connection" });
  },
},
```

**Step 4: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i defaultCommands || echo "No errors"`

**Step 5: Commit**

```bash
git add src/data/defaultCommands.ts
git commit -m "feat(command-palette): add switch database/schema and open connection commands"
```

---

## Group C: Nested List Components

### Task 3: Create NestedDatabaseList Component

**Files:**
- Create: `src/components/CommandPalette/NestedDatabaseList.tsx`

**Step 1: Create the component**

```typescript
import React, { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Fuse, { type IFuseOptions } from "fuse.js";
import {
  IconArrowLeft,
  IconCheck,
  IconCircleFilled,
  IconLoader2,
} from "@tabler/icons-react";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { databaseService } from "@/services/databaseService";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { cn } from "@/lib/utils";

interface DatabaseItem {
  name: string;
  hasProfile: boolean;
  isCurrent: boolean;
}

const FUSE_OPTIONS: IFuseOptions<DatabaseItem> = {
  keys: ["name"],
  threshold: 0.3,
  includeScore: true,
};

interface NestedDatabaseListProps {
  listRef?: React.RefObject<HTMLDivElement>;
  query: string;
  onSelect: (database: string) => void;
}

export function NestedDatabaseList({
  listRef,
  query,
  onSelect,
}: NestedDatabaseListProps) {
  const connectionId = useWorkspaceSelectionStore((s) => s.connectionId);
  const selectedDatabase = useWorkspaceSelectionStore((s) => s.database);
  const connections = useConnectionStore((s) => s.connections);
  const currentConnection = useConnectionStore((s) =>
    connectionId ? s.getConnection(connectionId) : null
  );
  const exitNestedMode = useCommandPaletteStore((s) => s.exitNestedMode);

  const { data: databases = [], isLoading, error } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => {
      if (!connectionId || !databaseService.isConnectionActive(connectionId)) {
        return [];
      }
      return await databaseService.listDatabases(connectionId);
    },
    enabled: !!connectionId && databaseService.isConnectionActive(connectionId),
    staleTime: 60_000,
  });

  const databaseItems = useMemo<DatabaseItem[]>(() => {
    if (!currentConnection) return [];
    const profile = currentConnection.profile;
    return databases.map((db) => {
      const hasProfile = connections.some(
        (conn) =>
          conn.profile.host === profile.host &&
          conn.profile.port === profile.port &&
          conn.profile.database === db &&
          conn.profile.username === profile.username
      );
      return {
        name: db,
        hasProfile,
        isCurrent: db === selectedDatabase,
      };
    });
  }, [databases, connections, currentConnection, selectedDatabase]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return databaseItems;
    const fuse = new Fuse(databaseItems, FUSE_OPTIONS);
    return fuse.search(query).map((r) => r.item);
  }, [databaseItems, query]);

  const handleBack = useCallback(() => {
    exitNestedMode();
  }, [exitNestedMode]);

  if (isLoading) {
    return (
      <CommandList ref={listRef}>
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading databases...
        </div>
      </CommandList>
    );
  }

  if (error) {
    return (
      <CommandList ref={listRef}>
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load databases
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No databases found.</CommandEmpty>
      <CommandGroup>
        <CommandItem onSelect={handleBack} className="text-muted-foreground">
          <IconArrowLeft className="mr-2 size-3.5" />
          Back
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Databases">
        {filteredItems.map((item) => (
          <CommandItem
            key={item.name}
            value={item.name}
            onSelect={() => onSelect(item.name)}
          >
            <IconCheck
              className={cn(
                "mr-2 size-3.5",
                item.isCurrent ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="flex-1">{item.name}</span>
            {item.hasProfile && (
              <IconCircleFilled className="size-2 text-primary" />
            )}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
```

**Step 2: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i NestedDatabaseList || echo "No errors"`

**Step 3: Commit**

```bash
git add src/components/CommandPalette/NestedDatabaseList.tsx
git commit -m "feat(command-palette): add NestedDatabaseList component"
```

---

### Task 4: Create NestedSchemaList Component

**Files:**
- Create: `src/components/CommandPalette/NestedSchemaList.tsx`

**Step 1: Create the component**

```typescript
import React, { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Fuse, { type IFuseOptions } from "fuse.js";
import {
  IconArrowLeft,
  IconCheck,
  IconLoader2,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { databaseService } from "@/services/databaseService";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { cn } from "@/lib/utils";

interface SchemaItem {
  name: string;
  isCurrent: boolean;
  isDefault: boolean;
}

const FUSE_OPTIONS: IFuseOptions<SchemaItem> = {
  keys: ["name"],
  threshold: 0.3,
  includeScore: true,
};

interface NestedSchemaListProps {
  listRef?: React.RefObject<HTMLDivElement>;
  query: string;
  onSelect: (schema: string) => void;
}

export function NestedSchemaList({
  listRef,
  query,
  onSelect,
}: NestedSchemaListProps) {
  const connectionId = useWorkspaceSelectionStore((s) => s.connectionId);
  const selectedDatabase = useWorkspaceSelectionStore((s) => s.database);
  const selectedSchema = useWorkspaceSelectionStore((s) => s.schema);
  const defaultSchema = useConnectionStore((s) =>
    connectionId ? s.getConnection(connectionId)?.profile.default_schema : null
  );
  const exitNestedMode = useCommandPaletteStore((s) => s.exitNestedMode);

  const { data: schemas = [], isLoading, error } = useQuery({
    queryKey: ["schemas", connectionId, selectedDatabase],
    queryFn: async () => {
      if (!connectionId || !selectedDatabase) return [];
      if (!databaseService.isConnectionActive(connectionId)) return [];
      return await databaseService.listSchemas(connectionId, selectedDatabase);
    },
    enabled:
      !!connectionId &&
      !!selectedDatabase &&
      databaseService.isConnectionActive(connectionId),
    staleTime: 60_000,
  });

  const schemaItems = useMemo<SchemaItem[]>(() => {
    return schemas.map((schema) => ({
      name: schema,
      isCurrent: schema === selectedSchema,
      isDefault: schema === defaultSchema,
    }));
  }, [schemas, selectedSchema, defaultSchema]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return schemaItems;
    const fuse = new Fuse(schemaItems, FUSE_OPTIONS);
    return fuse.search(query).map((r) => r.item);
  }, [schemaItems, query]);

  const handleBack = useCallback(() => {
    exitNestedMode();
  }, [exitNestedMode]);

  if (isLoading) {
    return (
      <CommandList ref={listRef}>
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading schemas...
        </div>
      </CommandList>
    );
  }

  if (error) {
    return (
      <CommandList ref={listRef}>
        <div className="py-6 text-center text-xs text-destructive">
          Failed to load schemas
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No schemas found.</CommandEmpty>
      <CommandGroup>
        <CommandItem onSelect={handleBack} className="text-muted-foreground">
          <IconArrowLeft className="mr-2 size-3.5" />
          Back
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Schemas">
        {filteredItems.map((item) => (
          <CommandItem
            key={item.name}
            value={item.name}
            onSelect={() => onSelect(item.name)}
          >
            <IconCheck
              className={cn(
                "mr-2 size-3.5",
                item.isCurrent ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="flex-1">{item.name}</span>
            {item.isDefault ? (
              <IconStarFilled className="size-3 text-yellow-500" />
            ) : null}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
```

**Step 2: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i NestedSchemaList || echo "No errors"`

**Step 3: Commit**

```bash
git add src/components/CommandPalette/NestedSchemaList.tsx
git commit -m "feat(command-palette): add NestedSchemaList component"
```

---

### Task 5: Create NestedConnectionList Component

**Files:**
- Create: `src/components/CommandPalette/NestedConnectionList.tsx`

**Step 1: Create the component**

```typescript
import React, { useCallback, useMemo } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { IconArrowLeft, IconDatabase } from "@tabler/icons-react";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { ConnectionProfile } from "@/types/connection";

interface ConnectionItem {
  id: string;
  name: string;
  database: string;
  host: string;
  db_type: ConnectionProfile["db_type"];
}

const FUSE_OPTIONS: IFuseOptions<ConnectionItem> = {
  keys: ["name", "database", "host"],
  threshold: 0.3,
  includeScore: true,
};

interface NestedConnectionListProps {
  listRef?: React.RefObject<HTMLDivElement>;
  query: string;
  onSelect: (connectionId: string) => void;
}

export function NestedConnectionList({
  listRef,
  query,
  onSelect,
}: NestedConnectionListProps) {
  const connections = useConnectionStore((s) => s.connections);
  const exitNestedMode = useCommandPaletteStore((s) => s.exitNestedMode);

  const connectionItems = useMemo<ConnectionItem[]>(() => {
    return connections.map((conn) => ({
      id: conn.profile.id,
      name: conn.profile.name,
      database: conn.profile.database || "",
      host: conn.profile.host,
      db_type: conn.profile.db_type,
    }));
  }, [connections]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return connectionItems;
    const fuse = new Fuse(connectionItems, FUSE_OPTIONS);
    return fuse.search(query).map((r) => r.item);
  }, [connectionItems, query]);

  const handleBack = useCallback(() => {
    exitNestedMode();
  }, [exitNestedMode]);

  return (
    <CommandList ref={listRef}>
      <CommandEmpty>No connections found.</CommandEmpty>
      <CommandGroup>
        <CommandItem onSelect={handleBack} className="text-muted-foreground">
          <IconArrowLeft className="mr-2 size-3.5" />
          Back
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Saved Connections">
        {filteredItems.map((item) => {
          const Logo = getDatabaseLogo(item.db_type);
          return (
            <CommandItem
              key={item.id}
              value={item.id}
              onSelect={() => onSelect(item.id)}
            >
              {Logo ? (
                <Logo className="mr-2 size-4" />
              ) : (
                <IconDatabase className="mr-2 size-4 text-muted-foreground" />
              )}
              <span className="flex-1 font-medium">{item.name}</span>
              <span className="text-muted-foreground text-xs">
                {item.database || item.host}
              </span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    </CommandList>
  );
}
```

**Step 2: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i NestedConnectionList || echo "No errors"`

**Step 3: Commit**

```bash
git add src/components/CommandPalette/NestedConnectionList.tsx
git commit -m "feat(command-palette): add NestedConnectionList component"
```

---

## Group D: Main Component Integration

### Task 6: Update CommandPalette for Nested Mode

**Files:**
- Modify: `src/components/CommandPalette/CommandPalette.tsx`

**Step 1: Add imports for nested components**

Add at top with other imports:

```typescript
import { NestedDatabaseList } from "./NestedDatabaseList";
import { NestedSchemaList } from "./NestedSchemaList";
import { NestedConnectionList } from "./NestedConnectionList";
```

**Step 2: Add nestedMode selector and handlers**

Inside the `CommandPalette` function, add after other store selectors:

```typescript
const nestedMode = useCommandPaletteStore((state) => state.nestedMode);
const exitNestedMode = useCommandPaletteStore((state) => state.exitNestedMode);
const setSelectedDatabase = useWorkspaceSelectionStore(
  (state) => state.setSelectedDatabase
);
const setSchema = useWorkspaceSelectionStore((state) => state.setSchema);
```

**Step 3: Add nested selection handlers**

Add after `handleKeyDown`:

```typescript
const handleDatabaseSelect = useCallback(
  async (database: string) => {
    if (!activeConnectionId) return;
    try {
      await databaseService.switchDatabase(activeConnectionId, database);
      setSelectedDatabase(database);
      closePalette();
    } catch (err) {
      console.error("Failed to switch database:", err);
      toast.error("Failed to switch database");
    }
  },
  [activeConnectionId, setSelectedDatabase, closePalette]
);

const handleSchemaSelect = useCallback(
  async (schema: string) => {
    if (!activeConnectionId) return;
    try {
      await databaseService.switchSchema(activeConnectionId, schema);
      setSchema(schema);
      closePalette();
    } catch (err) {
      console.error("Failed to switch schema:", err);
      toast.error("Failed to switch schema");
    }
  },
  [activeConnectionId, setSchema, closePalette]
);

const handleConnectionSelect = useCallback(
  async (connectionId: string) => {
    try {
      await windowManager.openWorkspaceWindow(connectionId);
      closePalette();
    } catch (err) {
      console.error("Failed to open connection:", err);
      toast.error("Failed to open connection");
    }
  },
  [closePalette]
);
```

**Step 4: Add backspace handler for exiting nested mode**

Update `handleKeyDown` to handle backspace:

```typescript
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent) => {
    // Handle Cmd/Ctrl+Enter for split view
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (selectedValue && !nestedMode) {
        void handleSelect(selectedValue, true);
      }
      return;
    }

    // Handle backspace to exit nested mode
    if (e.key === "Backspace" && query === "" && nestedMode) {
      e.preventDefault();
      exitNestedMode();
    }
  },
  [selectedValue, handleSelect, nestedMode, query, exitNestedMode]
);
```

**Step 5: Add imports for databaseService, windowManager, toast**

Ensure these imports exist at top:

```typescript
import { databaseService } from "@/services/databaseService";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";
```

**Step 6: Update placeholder based on nested mode**

Add helper function before the return:

```typescript
const getInputPlaceholder = () => {
  if (!nestedMode) return "Search tables, commands, and more...";
  switch (nestedMode.type) {
    case "switch-database":
      return "Search databases...";
    case "switch-schema":
      return "Search schemas...";
    case "open-connection":
      return "Search connections...";
  }
};
```

**Step 7: Update JSX to render nested lists conditionally**

Replace the `<CommandList>` section in the return with:

```typescript
{nestedMode ? (
  nestedMode.type === "switch-database" ? (
    <NestedDatabaseList
      listRef={listRef}
      query={query}
      onSelect={handleDatabaseSelect}
    />
  ) : nestedMode.type === "switch-schema" ? (
    <NestedSchemaList
      listRef={listRef}
      query={query}
      onSelect={handleSchemaSelect}
    />
  ) : (
    <NestedConnectionList
      listRef={listRef}
      query={query}
      onSelect={handleConnectionSelect}
    />
  )
) : (
  <CommandList ref={listRef}>
    {/* existing list content */}
  </CommandList>
)}
```

**Step 8: Update CommandInput placeholder**

```typescript
<CommandInput
  placeholder={getInputPlaceholder()}
  value={query}
  onValueChange={setQuery}
  className="border-none!"
/>
```

**Step 9: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep -i CommandPalette || echo "No errors"`

**Step 10: Commit**

```bash
git add src/components/CommandPalette/CommandPalette.tsx
git commit -m "feat(command-palette): integrate nested mode rendering"
```

---

### Task 7: Add Context-Aware Command Filtering

**Files:**
- Modify: `src/components/CommandPalette/useCommandPaletteQueries.ts`

**Step 1: Add context detection for workspace vs home**

In the `useCommands` query or `useUnifiedItems`, filter commands based on context:

```typescript
// Add after getting commands from commandService
const connectionId = useWorkspaceSelectionStore.getState().connectionId;
const isInWorkspace = !!connectionId;

// Filter commands based on context
const filteredCommands = commandsWithKeybindings.filter((cmd) => {
  // Workspace-only commands
  if (cmd.id === "workspace.switchDatabase" || cmd.id === "workspace.switchSchema") {
    return isInWorkspace;
  }
  // Home-only commands
  if (cmd.id === "connection.open") {
    return !isInWorkspace;
  }
  return true;
});
```

**Step 2: Verify filtering works**

Run: `pnpm typecheck`

**Step 3: Commit**

```bash
git add src/components/CommandPalette/useCommandPaletteQueries.ts
git commit -m "feat(command-palette): add context-aware command filtering"
```

---

## Group E: Tests

### Task 8: Add Store Tests

**Files:**
- Create: `src/stores/ui/__tests__/commandPaletteStore.test.ts`

**Step 1: Create test file**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useCommandPaletteStore } from "../commandPaletteStore";

describe("commandPaletteStore", () => {
  beforeEach(() => {
    const store = useCommandPaletteStore.getState();
    store.closePalette();
  });

  describe("nestedMode", () => {
    it("should initialize with null nestedMode", () => {
      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
    });

    it("should set nested mode and clear query", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setQuery("test");
        store.setNestedMode({ type: "switch-database" });
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toEqual({ type: "switch-database" });
      expect(state.query).toBe("");
    });

    it("should exit nested mode and clear query", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-schema" });
        store.setQuery("public");
        store.exitNestedMode();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
      expect(state.query).toBe("");
    });

    it("should reset nestedMode when closing palette", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.openPalette();
        store.setNestedMode({ type: "open-connection" });
        store.closePalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
      expect(state.isOpen).toBe(false);
    });

    it("should reset nestedMode when opening palette", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-database" });
        store.openPalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
    });
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit commandPaletteStore`

**Step 3: Commit**

```bash
git add src/stores/ui/__tests__/commandPaletteStore.test.ts
git commit -m "test(command-palette): add nestedMode store tests"
```

---

### Task 9: Run Full Test Suite

**Step 1: Run all tests**

Run: `pnpm test:unit`

**Step 2: Fix any failures**

**Step 3: Run typecheck**

Run: `pnpm typecheck`

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: address test and type issues"
```

---

## Verification Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:unit` passes
- [ ] Command palette opens with Cmd+K
- [ ] "Switch Database" command appears in workspace
- [ ] "Switch Schema" command appears in workspace
- [ ] "Open Connection" command appears on home page
- [ ] Selecting nested command shows sub-list
- [ ] Backspace on empty exits nested mode
- [ ] "← Back" item works
- [ ] ESC closes palette entirely
- [ ] Selecting database/schema switches and closes palette
- [ ] Selecting connection opens new window
