# Command Palette Raycast-Style Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform CommandPalette into a unified, Raycast-style search with frecency ranking and polished UI.

**Architecture:** Create a frecency store for tracking usage, unify all searchable items (tables, views, functions, commands) into a single data model, add fixed-height list and footer component for visual polish.

**Tech Stack:** React 19, Zustand (with persist middleware), Fuse.js, TypeScript, Vitest

---

## Task Groups (Parallelizable)

The following task groups can be executed in parallel by separate agents:

- **Group A**: Frecency Store (Tasks 1-2)
- **Group B**: UI Component Updates (Tasks 3-4)
- **Group C**: Unified Items & Search Logic (Tasks 5-6)
- **Group D**: Main Component Refactor (Tasks 7-8) - depends on A, B, C
- **Group E**: Tests (Tasks 9-11) - can start in parallel, finalize after D

---

## Group A: Frecency Store

### Task 1: Create Frecency Store

**Files:**
- Create: `src/stores/ui/commandPaletteFrecencyStore.ts`

**Step 1: Create the frecency store with localStorage persistence**

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FrecencyEntry {
  lastAccessed: number;
  accessCount: number;
}

interface FrecencyState {
  items: Record<string, FrecencyEntry>;
  recordAccess: (itemId: string) => void;
  clearHistory: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export function calculateFrecencyScore(entry: FrecencyEntry | undefined): number {
  if (!entry) return 0;

  const now = Date.now();
  const age = now - entry.lastAccessed;

  let recencyWeight: number;
  if (age < DAY_MS) {
    recencyWeight = 1.0;
  } else if (age < WEEK_MS) {
    recencyWeight = 0.7;
  } else if (age < MONTH_MS) {
    recencyWeight = 0.5;
  } else {
    recencyWeight = 0.3;
  }

  return entry.accessCount * recencyWeight;
}

export const useCommandPaletteFrecencyStore = create<FrecencyState>()(
  persist(
    (set) => ({
      items: {},

      recordAccess: (itemId: string) => {
        set((state) => ({
          items: {
            ...state.items,
            [itemId]: {
              lastAccessed: Date.now(),
              accessCount: (state.items[itemId]?.accessCount ?? 0) + 1,
            },
          },
        }));
      },

      clearHistory: () => {
        set({ items: {} });
      },
    }),
    {
      name: "command-palette-frecency",
    }
  )
);
```

**Step 2: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors related to commandPaletteFrecencyStore

**Step 3: Commit**

```bash
git add src/stores/ui/commandPaletteFrecencyStore.ts
git commit -m "feat(command-palette): add frecency store for usage tracking"
```

---

### Task 2: Create useFrecency Hook

**Files:**
- Create: `src/components/CommandPalette/useFrecency.ts`

**Step 1: Create the hook**

```typescript
import { useCallback, useMemo } from "react";
import {
  useCommandPaletteFrecencyStore,
  calculateFrecencyScore,
} from "@/stores/ui/commandPaletteFrecencyStore";

export function useFrecency() {
  const items = useCommandPaletteFrecencyStore((state) => state.items);
  const recordAccess = useCommandPaletteFrecencyStore((state) => state.recordAccess);

  const getFrecencyScore = useCallback(
    (itemId: string): number => {
      return calculateFrecencyScore(items[itemId]);
    },
    [items]
  );

  const sortByFrecency = useCallback(
    <T extends { id: string }>(itemList: T[]): T[] => {
      return [...itemList].sort((a, b) => {
        const scoreA = getFrecencyScore(a.id);
        const scoreB = getFrecencyScore(b.id);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        // Fallback to alphabetical by id
        return a.id.localeCompare(b.id);
      });
    },
    [getFrecencyScore]
  );

  const getTopFrecencyItems = useCallback(
    <T extends { id: string }>(itemList: T[], limit: number): T[] => {
      return sortByFrecency(itemList)
        .filter((item) => getFrecencyScore(item.id) > 0)
        .slice(0, limit);
    },
    [sortByFrecency, getFrecencyScore]
  );

  return {
    recordAccess,
    getFrecencyScore,
    sortByFrecency,
    getTopFrecencyItems,
  };
}
```

**Step 2: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/CommandPalette/useFrecency.ts
git commit -m "feat(command-palette): add useFrecency hook"
```

---

## Group B: UI Component Updates

### Task 3: Add CommandFooter Component

**Files:**
- Modify: `src/components/ui/command.tsx`

**Step 1: Add the CommandFooter component at the end of the file (before exports)**

```typescript
function CommandFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      data-slot="command-footer"
      className={cn(
        "border-t border-border/50 bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-4",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">↑</kbd>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">↓</kbd>
        <span className="ml-1">Navigate</span>
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">⏎</kbd>
        <span className="ml-1">Open</span>
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">{modKey}</kbd>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">⏎</kbd>
        <span className="ml-1">Open in Split</span>
      </span>
    </div>
  );
}
```

**Step 2: Add CommandFooter to exports**

Find the export block at the end of the file and add `CommandFooter`:

```typescript
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
}
```

**Step 3: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ui/command.tsx
git commit -m "feat(ui): add CommandFooter component"
```

---

### Task 4: Fix CommandList Height and Dialog Width

**Files:**
- Modify: `src/components/ui/command.tsx`

**Step 1: Update CommandList to have fixed height**

Find the `CommandList` function and update the className:

```typescript
function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar min-h-[360px] max-h-[360px] scroll-py-1 outline-none overflow-x-hidden overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}
```

**Step 2: Update CommandDialog width**

Find the `CommandDialog` function and update the DialogContent className:

```typescript
<DialogContent
  className={cn("rounded-xl! p-0 overflow-hidden w-[540px] max-w-[540px]", className)}
  showCloseButton={showCloseButton}
>
```

**Step 3: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ui/command.tsx
git commit -m "fix(ui): set fixed height for CommandList and wider dialog"
```

---

## Group C: Unified Items & Search Logic

### Task 5: Create Unified Item Types

**Files:**
- Modify: `src/components/CommandPalette/useCommandPaletteQueries.ts`

**Step 1: Add UnifiedItem type definition at the top of the file (after existing imports)**

```typescript
export type UnifiedItemType = "table" | "view" | "materializedView" | "function" | "command";

export interface UnifiedItem {
  id: string;
  type: UnifiedItemType;
  name: string;
  subtitle: string;
  schema?: string;
  keywords: string[];
  // Type-specific payload
  table?: TableMeta;
  func?: FunctionMeta;
  command?: CategorizedCommand;
}
```

**Step 2: Commit**

```bash
git add src/components/CommandPalette/useCommandPaletteQueries.ts
git commit -m "feat(command-palette): add UnifiedItem type"
```

---

### Task 6: Create useUnifiedItems Hook

**Files:**
- Modify: `src/components/CommandPalette/useCommandPaletteQueries.ts`

**Step 1: Add useUnifiedItems hook at the end of the file (before the closing)**

```typescript
/**
 * Hook that combines all searchable items into a unified list
 */
export function useUnifiedItems() {
  const { data: commands = [], isLoading: isLoadingCommands } = useCommands();
  const { quickItems, isLoading: isLoadingQuickOpen } = useQuickOpenItems();

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // Add database objects
    for (const item of quickItems) {
      if (item.entityType === "function") {
        items.push({
          id: item.id,
          type: "function",
          name: item.name,
          subtitle: item.schema,
          schema: item.schema,
          keywords: [item.searchKey, "function", "func"],
          func: item.func,
        });
      } else {
        items.push({
          id: item.id,
          type: item.entityType,
          name: item.name,
          subtitle: item.subtitle || item.schema,
          schema: item.schema,
          keywords: [item.searchKey, item.entityType],
          table: item.table,
        });
      }
    }

    // Add commands
    for (const command of commands) {
      items.push({
        id: `command:${command.id}`,
        type: "command",
        name: command.label,
        subtitle: command.keybinding?.resolvedLabel ?? "",
        keywords: [
          command.id,
          command.description ?? "",
          command.category ?? "",
          "command",
        ].filter(Boolean),
        command,
      });
    }

    return items;
  }, [commands, quickItems]);

  return {
    unifiedItems,
    isLoading: isLoadingCommands || isLoadingQuickOpen,
  };
}
```

**Step 2: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/CommandPalette/useCommandPaletteQueries.ts
git commit -m "feat(command-palette): add useUnifiedItems hook"
```

---

## Group D: Main Component Refactor

### Task 7: Simplify commandPaletteStore

**Files:**
- Modify: `src/stores/ui/commandPaletteStore.ts`

**Step 1: Read current store to understand structure**

Read the file first to see current implementation.

**Step 2: Remove mode and origin, simplify the store**

The store should be simplified to:

```typescript
import { create } from "zustand";

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",

  openPalette: () => {
    set({ isOpen: true, query: "" });
  },

  closePalette: () => {
    set({ isOpen: false, query: "" });
  },

  setQuery: (query: string) => {
    set({ query });
  },
}));
```

**Step 3: Verify file compiles**

Run: `pnpm typecheck`
Expected: Errors in CommandPalette.tsx (expected, will fix in next task)

**Step 4: Commit**

```bash
git add src/stores/ui/commandPaletteStore.ts
git commit -m "refactor(command-palette): simplify store, remove mode switching"
```

---

### Task 8: Refactor CommandPalette.tsx

**Files:**
- Modify: `src/components/CommandPalette/CommandPalette.tsx`

**Step 1: Replace entire CommandPalette.tsx with new implementation**

```typescript
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconCommand,
  IconEye,
  IconMathFunction,
  IconLoader2,
  IconTable,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQueryClient } from "@tanstack/react-query";

import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { contextService } from "@/services/contextService";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

import {
  openFunctionObject,
  openTableObject,
  openTableInSplitRight,
  openFunctionInSplitRight,
} from "@/utils/workbench/openers";
import { cn } from "@/lib/utils";
import { useUnifiedItems, type UnifiedItem } from "./useCommandPaletteQueries";
import { useFrecency } from "./useFrecency";

const MAX_RECENT_ITEMS_EMPTY = 12;
const MAX_RECENT_ITEMS_SEARCH = 8;
const MAX_RESULTS_PER_GROUP = 50;

// Fuse.js configuration for unified items
const UNIFIED_FUSE_OPTIONS: IFuseOptions<UnifiedItem> = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "keywords", weight: 0.3 },
    { name: "subtitle", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
};

type ItemGroup = "Recently Used" | "Tables" | "Views" | "Functions" | "Commands";

const GROUP_ORDER: ItemGroup[] = [
  "Recently Used",
  "Tables",
  "Views",
  "Functions",
  "Commands",
];

function getItemGroup(item: UnifiedItem): ItemGroup {
  switch (item.type) {
    case "table":
      return "Tables";
    case "view":
    case "materializedView":
      return "Views";
    case "function":
      return "Functions";
    case "command":
      return "Commands";
  }
}

function getItemIcon(item: UnifiedItem): React.ReactNode {
  switch (item.type) {
    case "table":
      return <IconTable className="text-orange-500" />;
    case "view":
      return <IconEye className="text-green-500" />;
    case "materializedView":
      return <IconEye className="text-blue-500" />;
    case "function":
      return <IconMathFunction className="text-purple-500" />;
    case "command":
      return <IconCommand className="text-muted-foreground" />;
  }
}

export function CommandPalette(): React.ReactElement {
  const queryClient = useQueryClient();
  const services = useKeyboardServicesOptional();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");

  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const query = useCommandPaletteStore((state) => state.query);
  const setQuery = useCommandPaletteStore((state) => state.setQuery);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);
  const openPalette = useCommandPaletteStore((state) => state.openPalette);

  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId
  );
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database
  );

  const { unifiedItems, isLoading } = useUnifiedItems();
  const { recordAccess, getFrecencyScore, getTopFrecencyItems, sortByFrecency } =
    useFrecency();

  // Invalidate cache when commands or keybindings change
  useEffect(() => {
    if (!services) return;

    const { commandService, keybindingService } = services;

    const disposers = [
      commandService.onDidRegister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      commandService.onDidUnregister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidRegister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidUnregister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidChange(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
    ];

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [services, queryClient]);

  useEffect(() => {
    contextService.setValue("inQuickOpen", isOpen);
    contextService.setValue("inCommandPalette", isOpen);

    return () => {
      if (!isOpen) {
        contextService.setValue("inQuickOpen", false);
        contextService.setValue("inCommandPalette", false);
      }
    };
  }, [isOpen]);

  const searchQuery = query.trim().toLowerCase();

  // Get recently used items
  const recentItems = useMemo(() => {
    const limit = searchQuery ? MAX_RECENT_ITEMS_SEARCH : MAX_RECENT_ITEMS_EMPTY;

    if (!searchQuery) {
      return getTopFrecencyItems(unifiedItems, limit);
    }

    // When searching, filter recent items by query match
    const fuse = new Fuse(unifiedItems, UNIFIED_FUSE_OPTIONS);
    const searchResults = fuse.search(searchQuery);
    const matchedIds = new Set(searchResults.map((r) => r.item.id));

    return getTopFrecencyItems(
      unifiedItems.filter((item) => matchedIds.has(item.id)),
      limit
    );
  }, [unifiedItems, searchQuery, getTopFrecencyItems]);

  const recentItemIds = useMemo(
    () => new Set(recentItems.map((item) => item.id)),
    [recentItems]
  );

  // Get grouped items (excluding recent)
  const groupedItems = useMemo(() => {
    let itemsToGroup = unifiedItems.filter((item) => !recentItemIds.has(item.id));

    if (searchQuery) {
      const fuse = new Fuse(itemsToGroup, UNIFIED_FUSE_OPTIONS);
      const results = fuse.search(searchQuery);
      itemsToGroup = results.map((r) => r.item);
    }

    // Group by type
    const groups = new Map<ItemGroup, UnifiedItem[]>();
    for (const item of itemsToGroup) {
      const group = getItemGroup(item);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(item);
    }

    // Sort within groups by frecency then alphabetically
    for (const [group, items] of groups) {
      groups.set(
        group,
        sortByFrecency(items).slice(0, MAX_RESULTS_PER_GROUP)
      );
    }

    return GROUP_ORDER.filter((group) => group !== "Recently Used" && groups.has(group)).map(
      (group) => [group, groups.get(group)!] as [ItemGroup, UnifiedItem[]]
    );
  }, [unifiedItems, searchQuery, recentItemIds, sortByFrecency]);

  // Scroll to top when results change
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [recentItems, groupedItems]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
      } else {
        openPalette();
      }
    },
    [closePalette, openPalette]
  );

  const handleSelect = useCallback(
    async (value: string, openInSplit: boolean) => {
      const item = unifiedItems.find((i) => i.id === value);
      if (!item) {
        closePalette();
        return;
      }

      // Record usage for frecency
      recordAccess(item.id);

      if (item.type === "command" && item.command) {
        if (!services) return;
        try {
          await services.commandService.execute(item.command.id);
        } finally {
          closePalette();
        }
        return;
      }

      if (!activeConnectionId) {
        closePalette();
        return;
      }

      if (item.type === "function" && item.func) {
        if (openInSplit) {
          openFunctionInSplitRight({
            func: item.func,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
          });
        } else {
          openFunctionObject({
            func: item.func,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
          });
        }
      } else if (item.table) {
        if (openInSplit) {
          openTableInSplitRight({
            table: item.table,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
            viewType: "data",
          });
        } else {
          openTableObject({
            table: item.table,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
            viewType: "data",
          });
        }
      }

      closePalette();
    },
    [
      unifiedItems,
      activeConnectionId,
      closePalette,
      services,
      selectedDatabase,
      recordAccess,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedValue) {
          void handleSelect(selectedValue, true);
        }
      }
    },
    [selectedValue, handleSelect]
  );

  if (!services) {
    return <></>;
  }

  const emptyMessage = isLoading
    ? ""
    : searchQuery
    ? "No results found."
    : "No items available.";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      onKeyDown={handleKeyDown}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder="Search tables, commands, and more..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
            <IconLoader2 className="size-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            <CommandEmpty>{emptyMessage}</CommandEmpty>

            {recentItems.length > 0 && (
              <CommandGroup heading="Recently Used">
                {recentItems.map((item) => (
                  <UnifiedItemRow
                    key={item.id}
                    item={item}
                    onSelect={(id) => handleSelect(id, false)}
                  />
                ))}
              </CommandGroup>
            )}

            {recentItems.length > 0 && groupedItems.length > 0 && (
              <CommandSeparator />
            )}

            {groupedItems.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => (
                  <UnifiedItemRow
                    key={item.id}
                    item={item}
                    onSelect={(id) => handleSelect(id, false)}
                  />
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  );
}

interface UnifiedItemRowProps {
  item: UnifiedItem;
  onSelect: (id: string) => void;
}

function UnifiedItemRow({ item, onSelect }: UnifiedItemRowProps) {
  return (
    <CommandItem value={item.id} onSelect={onSelect}>
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2 flex-1 truncate">
          {getItemIcon(item)}
          <span className="font-medium">{item.name}</span>
          {item.schema && (
            <span className="text-muted-foreground text-xs">{item.schema}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground text-right max-w-1/3 truncate">
          {item.type === "command" && item.command?.keybinding ? (
            <KbdGroup>
              {item.command.keybinding.resolvedLabel.split("+").map((key, i) => (
                <Kbd key={i}>{key.trim()}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            item.subtitle
          )}
        </div>
      </div>
    </CommandItem>
  );
}
```

**Step 2: Verify file compiles**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Test manually**

Run: `pnpm tauri:dev`
- Open command palette with Cmd+K or Cmd+P
- Verify unified search works
- Verify recently used section appears after selecting items
- Verify fixed height (no input shifting)
- Verify footer shows keyboard shortcuts

**Step 4: Commit**

```bash
git add src/components/CommandPalette/CommandPalette.tsx
git commit -m "feat(command-palette): implement unified Raycast-style search"
```

---

## Group E: Tests

### Task 9: Test Frecency Store

**Files:**
- Create: `src/stores/ui/__tests__/commandPaletteFrecencyStore.test.ts`

**Step 1: Write tests for frecency store**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useCommandPaletteFrecencyStore,
  calculateFrecencyScore,
} from "../commandPaletteFrecencyStore";

describe("commandPaletteFrecencyStore", () => {
  beforeEach(() => {
    // Reset store state
    const { result } = renderHook(() => useCommandPaletteFrecencyStore());
    act(() => {
      result.current.clearHistory();
    });
  });

  describe("recordAccess", () => {
    it("should record first access for an item", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
      });

      expect(result.current.items["item-1"]).toBeDefined();
      expect(result.current.items["item-1"].accessCount).toBe(1);
    });

    it("should increment access count on subsequent accesses", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-1");
      });

      expect(result.current.items["item-1"].accessCount).toBe(3);
    });

    it("should update lastAccessed timestamp", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());
      const before = Date.now();

      act(() => {
        result.current.recordAccess("item-1");
      });

      const after = Date.now();
      expect(result.current.items["item-1"].lastAccessed).toBeGreaterThanOrEqual(before);
      expect(result.current.items["item-1"].lastAccessed).toBeLessThanOrEqual(after);
    });
  });

  describe("clearHistory", () => {
    it("should clear all items", () => {
      const { result } = renderHook(() => useCommandPaletteFrecencyStore());

      act(() => {
        result.current.recordAccess("item-1");
        result.current.recordAccess("item-2");
        result.current.clearHistory();
      });

      expect(Object.keys(result.current.items)).toHaveLength(0);
    });
  });

  describe("calculateFrecencyScore", () => {
    it("should return 0 for undefined entry", () => {
      expect(calculateFrecencyScore(undefined)).toBe(0);
    });

    it("should return accessCount * 1.0 for recent access (today)", () => {
      const entry = {
        lastAccessed: Date.now() - 1000, // 1 second ago
        accessCount: 5,
      };
      expect(calculateFrecencyScore(entry)).toBe(5);
    });

    it("should return accessCount * 0.7 for access this week", () => {
      const entry = {
        lastAccessed: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(7);
    });

    it("should return accessCount * 0.5 for access this month", () => {
      const entry = {
        lastAccessed: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(5);
    });

    it("should return accessCount * 0.3 for old access", () => {
      const entry = {
        lastAccessed: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
        accessCount: 10,
      };
      expect(calculateFrecencyScore(entry)).toBe(3);
    });
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit commandPaletteFrecencyStore`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/stores/ui/__tests__/commandPaletteFrecencyStore.test.ts
git commit -m "test(command-palette): add frecency store tests"
```

---

### Task 10: Test useFrecency Hook

**Files:**
- Create: `src/components/CommandPalette/__tests__/useFrecency.test.ts`

**Step 1: Write tests for useFrecency hook**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFrecency } from "../useFrecency";
import { useCommandPaletteFrecencyStore } from "@/stores/ui/commandPaletteFrecencyStore";

describe("useFrecency", () => {
  beforeEach(() => {
    // Reset store
    const { result } = renderHook(() => useCommandPaletteFrecencyStore());
    act(() => {
      result.current.clearHistory();
    });
  });

  describe("sortByFrecency", () => {
    it("should sort items by frecency score descending", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      // Record different access patterns
      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-b");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }, { id: "item-c" }];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted[0].id).toBe("item-b"); // 3 accesses
      expect(sorted[1].id).toBe("item-a"); // 1 access
      expect(sorted[2].id).toBe("item-c"); // 0 accesses
    });

    it("should fallback to alphabetical for equal scores", () => {
      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "zebra" }, { id: "apple" }, { id: "mango" }];

      const sorted = result.current.sortByFrecency(items);

      expect(sorted[0].id).toBe("apple");
      expect(sorted[1].id).toBe("mango");
      expect(sorted[2].id).toBe("zebra");
    });
  });

  describe("getTopFrecencyItems", () => {
    it("should return only items with frecency > 0", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }];

      const top = result.current.getTopFrecencyItems(items, 10);

      expect(top).toHaveLength(1);
      expect(top[0].id).toBe("item-a");
    });

    it("should respect limit parameter", () => {
      const { result: storeResult } = renderHook(() =>
        useCommandPaletteFrecencyStore()
      );

      act(() => {
        storeResult.current.recordAccess("item-a");
        storeResult.current.recordAccess("item-b");
        storeResult.current.recordAccess("item-c");
      });

      const { result } = renderHook(() => useFrecency());
      const items = [{ id: "item-a" }, { id: "item-b" }, { id: "item-c" }];

      const top = result.current.getTopFrecencyItems(items, 2);

      expect(top).toHaveLength(2);
    });
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit useFrecency`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/components/CommandPalette/__tests__/useFrecency.test.ts
git commit -m "test(command-palette): add useFrecency hook tests"
```

---

### Task 11: Test useUnifiedItems Hook

**Files:**
- Create: `src/components/CommandPalette/__tests__/useUnifiedItems.test.ts`

**Step 1: Write tests for useUnifiedItems**

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the dependencies
vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServices: () => ({
    commandService: {
      list: () => [
        {
          id: "test.command",
          label: "Test Command",
          category: "Test",
        },
      ],
    },
    keybindingService: {
      list: () => [],
    },
  }),
}));

vi.mock("@/hooks/useSchemaData", () => ({
  useSchemaData: () => ({
    tables: [
      {
        name: "users",
        schema: "public",
        row_estimate: 100,
      },
    ],
    views: [],
    functions: [],
    isLoading: false,
    error: null,
  }),
}));

import { useUnifiedItems } from "../useCommandPaletteQueries";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useUnifiedItems", () => {
  it("should combine tables and commands into unified items", async () => {
    const { result } = renderHook(() => useUnifiedItems(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const items = result.current.unifiedItems;

    // Should have 1 table + 1 command
    expect(items.length).toBe(2);

    // Check table item
    const tableItem = items.find((i) => i.type === "table");
    expect(tableItem).toBeDefined();
    expect(tableItem?.name).toBe("users");

    // Check command item
    const commandItem = items.find((i) => i.type === "command");
    expect(commandItem).toBeDefined();
    expect(commandItem?.name).toBe("Test Command");
  });
});
```

**Step 2: Run tests**

Run: `pnpm test:unit useUnifiedItems`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/components/CommandPalette/__tests__/useUnifiedItems.test.ts
git commit -m "test(command-palette): add useUnifiedItems hook tests"
```

---

## Final Verification

After all tasks complete:

1. Run full test suite: `pnpm test:unit`
2. Run type check: `pnpm typecheck`
3. Run lint: `pnpm lint`
4. Manual testing with `pnpm tauri:dev`:
   - Open palette, verify fixed height
   - Search for tables, commands
   - Select items, verify frecency tracking
   - Re-open palette, verify "Recently Used" section
   - Test keyboard shortcuts (⏎, ⌘⏎)
