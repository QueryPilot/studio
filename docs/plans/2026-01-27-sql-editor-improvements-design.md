# SQL Editor Improvements Design

**Date:** 2026-01-27
**Status:** Ready for Implementation
**Priority Order:** D → C → B → A

---

## Overview

Four improvements to the SQL editor experience:

| ID | Feature | Scope | Files |
|----|---------|-------|-------|
| D | Autocomplete popup fix | Small | 1 file |
| C | Formatter cursor preservation | Small | 1 file |
| B | Multi-connection Cmd+T | Small | 3 files |
| A | Query History System | Large | 8+ files |

---

## D: Autocomplete Popup Clipping Fix

### Problem
Completion popup is clipped by editor boundaries when triggered near edges.

### Solution
Add CodeMirror's `tooltips` extension to mount tooltips to `document.body`.

### Implementation

**File:** `src/components/CodeEditor/SqlEditor.tsx`

```typescript
// Add import (around line 30)
import { tooltips } from "@codemirror/view";

// In editor extensions (around line 680-720), add:
tooltips({ parent: document.body }),

// Also update autocompletion config (line 547-552):
autocompletion({
  activateOnTyping: true,
  activateOnTypingDelay: 150,
  maxRenderedOptions: 50,  // was 30
  defaultKeymap: true,
}),
```

### Z-Index Analysis
- Dialogs use `z-50` (Tailwind)
- CM body-mounted tooltips use ~10000+ by default
- No conflicts expected

---

## C: Formatter Cursor Preservation

### Problem
Formatting resets cursor to line start instead of preserving position within the code.

### Solution
Token-based cursor mapping:
1. Before format: count tokens before cursor
2. After format: restore cursor after same token count
3. Supports multi-cursor selections
4. Falls back to line+column on parse errors

### Implementation

**File:** `src/components/CodeEditor/extensions/formatter.ts`

```typescript
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";

// ============ Token Anchor Types ============

interface TokenAnchor {
  tokenIndex: number;      // Number of tokens before cursor
  fallbackLine: number;    // Fallback: line number
  fallbackCol: number;     // Fallback: column in line
}

// ============ Token Position Helpers ============

/**
 * Count tokens before a position using Lezer syntax tree
 */
function getTokenAnchor(state: EditorState, pos: number): TokenAnchor {
  const tree = syntaxTree(state);
  let tokenIndex = 0;

  // Walk tree nodes up to cursor position
  tree.iterate({
    from: 0,
    to: pos,
    enter(node) {
      // Only count leaf nodes (actual tokens)
      if (node.node.firstChild === null && node.from < pos) {
        tokenIndex++;
      }
    }
  });

  // Fallback position
  const line = state.doc.lineAt(pos);

  return {
    tokenIndex,
    fallbackLine: line.number,
    fallbackCol: pos - line.from,
  };
}

/**
 * Find position after N tokens in formatted document
 */
function restoreFromTokenAnchor(state: EditorState, anchor: TokenAnchor): number {
  const tree = syntaxTree(state);
  let tokenIndex = 0;
  let targetPos = 0;

  try {
    tree.iterate({
      enter(node) {
        if (node.node.firstChild === null) { // Leaf node = token
          tokenIndex++;
          if (tokenIndex === anchor.tokenIndex) {
            targetPos = node.to;
            return false; // Stop iteration
          }
        }
      }
    });
  } catch {
    // Parse error - use fallback
  }

  // If token count changed, use fallback
  if (tokenIndex < anchor.tokenIndex || targetPos === 0) {
    const lineCount = state.doc.lines;
    const targetLine = Math.min(anchor.fallbackLine, lineCount);
    const line = state.doc.line(targetLine);
    return Math.min(line.from + anchor.fallbackCol, line.to);
  }

  return targetPos;
}

// ============ Updated Format Function ============

function formatDocument(view: EditorView, dialect: SqlDialect): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const hasSelection = from !== to;

  // Capture ALL selection ranges for multi-cursor support
  const anchors = state.selection.ranges.map(range => ({
    anchor: getTokenAnchor(state, range.anchor),
    head: getTokenAnchor(state, range.head),
  }));

  const textToFormat = hasSelection
    ? state.doc.sliceString(from, to)
    : state.doc.toString();

  try {
    const formatted = formatSql(textToFormat, dialect);
    if (formatted === textToFormat) return true;

    if (hasSelection) {
      // Format selection only
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: { anchor: from, head: from + formatted.length },
      });
    } else {
      // Format entire document, then restore cursors
      view.dispatch({
        changes: { from: 0, to: state.doc.length, insert: formatted },
      });

      // Restore all cursor positions
      const newState = view.state;
      const newRanges = anchors.map(({ anchor, head }) => {
        const newAnchor = restoreFromTokenAnchor(newState, anchor);
        const newHead = restoreFromTokenAnchor(newState, head);
        return EditorSelection.range(newAnchor, newHead);
      });

      view.dispatch({
        selection: EditorSelection.create(newRanges),
      });
    }

    return true;
  } catch {
    return false;
  }
}
```

### Test Cases

| Scenario | Expected |
|----------|----------|
| Cursor mid-identifier | Stays after same token |
| Cursor between tokens | Stays between same tokens |
| Multi-cursor | All cursors preserved |
| Parse error | Falls back to line+column |

---

## B: Multi-Connection Cmd+T

### Problem
Cmd+T always uses current workspace connection without prompting when multiple connections are open.

### Solution
Show connection picker in command palette when 2+ connections are connected.

### Implementation

**File 1:** `src/stores/ui/commandPaletteStore.ts`

```typescript
export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" }
  | { type: "switch-workspace" }
  | { type: "new-query-connection" };  // ADD THIS
```

**File 2:** `src/data/defaultCommands.ts`

Update `workbench.action.newQueryTab` handler:

```typescript
{
  id: "workbench.action.newQueryTab",
  label: "New Query Tab",
  category: "Workbench",
  when: "activeEditor",
  handler: () => {
    const connectionStore = useConnectionStore.getState();
    const workspaceSelection = useWorkspaceSelectionStore.getState();

    // Get connected connections
    const connections = connectionStore.connections.filter(
      c => c.status === "connected"
    );

    // If multiple connections, show picker
    if (connections.length > 1) {
      const paletteStore = useCommandPaletteStore.getState();
      paletteStore.setNestedMode({ type: "new-query-connection" });
      paletteStore.openPalette();
      return;
    }

    // Single or no connection - existing behavior
    // ... rest of existing handler ...
  },
},
```

**File 3:** `src/components/CommandPalette/CommandPalette.tsx`

Add handler for new nested mode:

```typescript
if (nestedMode?.type === "new-query-connection") {
  return (
    <NestedConnectionList
      listRef={listRef}
      query={query}
      onSelect={(connectionId) => {
        createNewQueryTabForConnection(connectionId);
        closePalette();
      }}
      onClose={closePalette}
      title="Select Connection for New Query"
    />
  );
}
```

### Flow

```
Cmd+T → Check connections → 1: Create tab directly
                          → 2+: Show picker → Select → Create tab
```

---

## A: Query History System

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Dexie/IndexDB  ◄──  Zustand Store  ◄──  Query Execution    │
│  (persistence)      (cache + UI)        (all paths)         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Sidebar (vertical tabs)  │  Command Palette (Cmd+Shift+H) │
│  [Objects] [Queries]      │  Search history, save query    │
└─────────────────────────────────────────────────────────────┘
```

### A.1 Database Schema

**File:** `src/lib/db/queryHistory.ts`

```typescript
import Dexie, { type Table } from "dexie";
import { nanoid } from "nanoid";

// ============ Interfaces ============

export interface QueryHistoryEntry {
  id: string;
  query: string;
  connectionId: string;
  profileId: string;           // Stable ID (survives reconnects)
  database: string;
  schema?: string;
  executedAt: number;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
  source: QuerySource;
}

export type QuerySource =
  | "editor"
  | "grid"
  | "ai"
  | "background"
  | "restore";

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  description?: string;
  tags: string[];
  profileId?: string;
  database?: string;
  schema?: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
}

// ============ Database ============

class QueryHistoryDB extends Dexie {
  history!: Table<QueryHistoryEntry>;
  saved!: Table<SavedQuery>;

  constructor() {
    super("QueryHistoryDB");

    this.version(1).stores({
      history: "id, profileId, executedAt, [profileId+executedAt]",
      saved: "id, profileId, updatedAt, *tags, starred",
    });
  }
}

export const queryHistoryDB = new QueryHistoryDB();

// ============ API Functions ============

export async function addHistoryEntry(
  entry: Omit<QueryHistoryEntry, "id">
): Promise<string> {
  const id = nanoid();
  await queryHistoryDB.history.add({ ...entry, id });
  await enforceRetentionPolicy();
  return id;
}

export async function getHistory(options?: {
  profileId?: string;
  limit?: number;
  offset?: number;
  since?: number;
}): Promise<QueryHistoryEntry[]> {
  let query = queryHistoryDB.history.orderBy("executedAt").reverse();

  if (options?.profileId) {
    query = queryHistoryDB.history
      .where("profileId")
      .equals(options.profileId)
      .reverse();
  }

  if (options?.since) {
    query = query.filter(e => e.executedAt >= options.since);
  }

  if (options?.offset) {
    query = query.offset(options.offset);
  }

  return query.limit(options?.limit ?? 100).toArray();
}

export async function clearHistory(profileId?: string): Promise<void> {
  if (profileId) {
    await queryHistoryDB.history.where("profileId").equals(profileId).delete();
  } else {
    await queryHistoryDB.history.clear();
  }
}

export async function saveQuery(
  query: Omit<SavedQuery, "id">
): Promise<string> {
  const id = nanoid();
  await queryHistoryDB.saved.add({ ...query, id });
  return id;
}

export async function updateSavedQuery(
  id: string,
  updates: Partial<SavedQuery>
): Promise<void> {
  await queryHistoryDB.saved.update(id, updates);
}

export async function deleteSavedQuery(id: string): Promise<void> {
  await queryHistoryDB.saved.delete(id);
}

export async function getSavedQueries(options?: {
  profileId?: string;
  tag?: string;
}): Promise<SavedQuery[]> {
  let collection = queryHistoryDB.saved.orderBy("updatedAt").reverse();

  if (options?.profileId) {
    collection = queryHistoryDB.saved
      .where("profileId")
      .equals(options.profileId);
  }

  if (options?.tag) {
    collection = queryHistoryDB.saved
      .where("tags")
      .equals(options.tag);
  }

  return collection.toArray();
}

// ============ Retention Policy ============

async function enforceRetentionPolicy(): Promise<void> {
  const MAX_ENTRIES = 1000;
  const MAX_AGE_DAYS = 30;

  const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  // Delete old entries
  await queryHistoryDB.history
    .where("executedAt")
    .below(cutoff)
    .delete();

  // Keep only last N entries
  const count = await queryHistoryDB.history.count();
  if (count > MAX_ENTRIES) {
    const toDelete = await queryHistoryDB.history
      .orderBy("executedAt")
      .limit(count - MAX_ENTRIES)
      .primaryKeys();
    await queryHistoryDB.history.bulkDelete(toDelete);
  }
}
```

### A.2 Zustand Store

**File:** `src/stores/queryHistoryStore.ts`

```typescript
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  addHistoryEntry,
  getHistory,
  getSavedQueries,
  saveQuery,
  updateSavedQuery,
  deleteSavedQuery,
  clearHistory,
  type QueryHistoryEntry,
  type SavedQuery,
  type QuerySource,
} from "@/lib/db/queryHistory";

interface QueryHistoryState {
  // Data
  recentHistory: QueryHistoryEntry[];
  savedQueries: SavedQuery[];

  // UI state
  isLoading: boolean;
  activeTab: "history" | "saved";
  searchQuery: string;
  filterProfileId: string | null;

  // Actions
  loadHistory: (options?: { profileId?: string; limit?: number }) => Promise<void>;
  trackExecution: (params: {
    query: string;
    connectionId: string;
    profileId: string;
    database: string;
    schema?: string;
    executionTimeMs?: number;
    rowCount?: number;
    success: boolean;
    error?: string;
    source: QuerySource;
  }) => Promise<void>;
  clearHistory: (profileId?: string) => Promise<void>;

  loadSavedQueries: (profileId?: string) => Promise<void>;
  saveCurrentQuery: (params: {
    name: string;
    query: string;
    description?: string;
    tags?: string[];
    profileId?: string;
    database?: string;
    schema?: string;
  }) => Promise<string>;
  updateSaved: (id: string, updates: Partial<SavedQuery>) => Promise<void>;
  deleteSaved: (id: string) => Promise<void>;
  toggleStarred: (id: string) => Promise<void>;

  setActiveTab: (tab: "history" | "saved") => void;
  setSearchQuery: (query: string) => void;
  setFilterProfileId: (profileId: string | null) => void;
}

export const useQueryHistoryStore = create<QueryHistoryState>()(
  subscribeWithSelector((set, get) => ({
    recentHistory: [],
    savedQueries: [],
    isLoading: false,
    activeTab: "history",
    searchQuery: "",
    filterProfileId: null,

    loadHistory: async (options) => {
      set({ isLoading: true });
      try {
        const history = await getHistory({
          profileId: options?.profileId ?? get().filterProfileId ?? undefined,
          limit: options?.limit ?? 100,
        });
        set({ recentHistory: history });
      } finally {
        set({ isLoading: false });
      }
    },

    trackExecution: async (params) => {
      const id = await addHistoryEntry({
        ...params,
        executedAt: Date.now(),
      });

      const newEntry: QueryHistoryEntry = {
        id,
        ...params,
        executedAt: Date.now(),
      };

      set(state => ({
        recentHistory: [newEntry, ...state.recentHistory].slice(0, 100),
      }));
    },

    clearHistory: async (profileId) => {
      await clearHistory(profileId);
      set({ recentHistory: [] });
    },

    loadSavedQueries: async (profileId) => {
      set({ isLoading: true });
      try {
        const saved = await getSavedQueries({ profileId });
        set({ savedQueries: saved });
      } finally {
        set({ isLoading: false });
      }
    },

    saveCurrentQuery: async (params) => {
      const id = await saveQuery({
        ...params,
        tags: params.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        starred: false,
      });
      await get().loadSavedQueries(get().filterProfileId ?? undefined);
      return id;
    },

    updateSaved: async (id, updates) => {
      await updateSavedQuery(id, { ...updates, updatedAt: Date.now() });
      set(state => ({
        savedQueries: state.savedQueries.map(q =>
          q.id === id ? { ...q, ...updates, updatedAt: Date.now() } : q
        ),
      }));
    },

    deleteSaved: async (id) => {
      await deleteSavedQuery(id);
      set(state => ({
        savedQueries: state.savedQueries.filter(q => q.id !== id),
      }));
    },

    toggleStarred: async (id) => {
      const query = get().savedQueries.find(q => q.id === id);
      if (query) {
        await get().updateSaved(id, { starred: !query.starred });
      }
    },

    setActiveTab: (tab) => set({ activeTab: tab }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setFilterProfileId: (profileId) => {
      set({ filterProfileId: profileId });
      get().loadHistory({ profileId: profileId ?? undefined });
      get().loadSavedQueries(profileId ?? undefined);
    },
  }))
);

// Selectors
export const useFilteredHistory = () => {
  return useQueryHistoryStore(state => {
    const { recentHistory, searchQuery } = state;
    if (!searchQuery) return recentHistory;

    const lower = searchQuery.toLowerCase();
    return recentHistory.filter(h =>
      h.query.toLowerCase().includes(lower)
    );
  });
};

export const useFilteredSavedQueries = () => {
  return useQueryHistoryStore(state => {
    const { savedQueries, searchQuery } = state;
    if (!searchQuery) return savedQueries;

    const lower = searchQuery.toLowerCase();
    return savedQueries.filter(q =>
      q.name.toLowerCase().includes(lower) ||
      q.query.toLowerCase().includes(lower) ||
      q.tags.some(t => t.toLowerCase().includes(lower))
    );
  });
};
```

### A.3 UI Components

**Directory:** `src/components/QueryHistory/`

**File:** `QueryHistoryPanel.tsx`

```typescript
import { useRef, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { QueryHistoryList } from "./QueryHistoryList";
import { SavedQueriesList } from "./SavedQueriesList";
import { IconSearch, IconHistory, IconBookmark } from "@tabler/icons-react";
import { eventBus } from "@/services/eventBus";

export function QueryHistoryPanel() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { activeTab, setActiveTab, searchQuery, setSearchQuery } =
    useQueryHistoryStore();

  useEffect(() => {
    const handleFocusSearch = () => {
      searchInputRef.current?.focus();
    };

    eventBus.on("query-history:focus-search", handleFocusSearch);
    return () => eventBus.off("query-history:focus-search", handleFocusSearch);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="p-1">
        <div className="relative">
          <IconSearch className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search queries..."
            className="pl-6 h-7 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-1 h-7">
          <TabsTrigger value="history" className="text-xs gap-1">
            <IconHistory className="h-3 w-3" />
            History
          </TabsTrigger>
          <TabsTrigger value="saved" className="text-xs gap-1">
            <IconBookmark className="h-3 w-3" />
            Saved
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="flex-1 mt-0 overflow-hidden">
          <QueryHistoryList />
        </TabsContent>

        <TabsContent value="saved" className="flex-1 mt-0 overflow-hidden">
          <SavedQueriesList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**File:** `QueryHistoryList.tsx`

```typescript
import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFilteredHistory, useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { IconCheck, IconX, IconClock, IconDatabase } from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { IconPlayerPlay, IconBookmarkPlus, IconCopy } from "@tabler/icons-react";
import type { QueryHistoryEntry } from "@/lib/db/queryHistory";

export function QueryHistoryList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const history = useFilteredHistory();
  const { loadHistory, isLoading } = useQueryHistoryStore();

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  if (isLoading && history.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">Loading...</div>;
  }

  if (history.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No query history yet
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const entry = history[virtualItem.index];
          return (
            <HistoryItem
              key={entry.id}
              entry={entry}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function HistoryItem({
  entry,
  style
}: {
  entry: QueryHistoryEntry;
  style: React.CSSProperties;
}) {
  const truncatedQuery = entry.query.slice(0, 80).replace(/\s+/g, " ");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          style={style}
          className={cn(
            "px-2 py-1.5 border-b cursor-pointer hover:bg-accent",
            "flex flex-col gap-0.5"
          )}
        >
          <code className="text-xs font-mono truncate">
            {truncatedQuery}
            {entry.query.length > 80 && "..."}
          </code>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {entry.success ? (
              <IconCheck className="h-3 w-3 text-green-500" />
            ) : (
              <IconX className="h-3 w-3 text-red-500" />
            )}

            <span className="flex items-center gap-0.5">
              <IconClock className="h-2.5 w-2.5" />
              {formatDistanceToNow(entry.executedAt, { addSuffix: true })}
            </span>

            {entry.executionTimeMs && (
              <span>{entry.executionTimeMs}ms</span>
            )}

            {entry.rowCount !== undefined && (
              <span>{entry.rowCount} rows</span>
            )}

            <span className="flex items-center gap-0.5 ml-auto">
              <IconDatabase className="h-2.5 w-2.5" />
              {entry.database}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem>
          <IconPlayerPlay className="h-3 w-3 mr-2" />
          Open in New Tab
        </ContextMenuItem>
        <ContextMenuItem>
          <IconBookmarkPlus className="h-3 w-3 mr-2" />
          Save Query
        </ContextMenuItem>
        <ContextMenuItem>
          <IconCopy className="h-3 w-3 mr-2" />
          Copy SQL
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

**File:** `SavedQueriesList.tsx`

```typescript
import { useEffect } from "react";
import { useFilteredSavedQueries, useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { cn } from "@/lib/utils";
import { IconStar } from "@tabler/icons-react";
import type { SavedQuery } from "@/lib/db/queryHistory";

export function SavedQueriesList() {
  const savedQueries = useFilteredSavedQueries();
  const { loadSavedQueries, toggleStarred, deleteSaved } = useQueryHistoryStore();

  useEffect(() => {
    loadSavedQueries();
  }, [loadSavedQueries]);

  const sorted = [...savedQueries].sort((a, b) => {
    if (a.starred !== b.starred) return b.starred ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

  if (sorted.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No saved queries yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {sorted.map((query) => (
        <SavedQueryItem
          key={query.id}
          query={query}
          onToggleStar={() => toggleStarred(query.id)}
          onDelete={() => deleteSaved(query.id)}
        />
      ))}
    </div>
  );
}

function SavedQueryItem({
  query,
  onToggleStar,
  onDelete
}: {
  query: SavedQuery;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="px-2 py-1.5 border-b hover:bg-accent cursor-pointer">
      <div className="flex items-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); onToggleStar(); }}>
          <IconStar className={cn(
            "h-3 w-3",
            query.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
          )} />
        </button>
        <span className="text-xs font-medium truncate">{query.name}</span>
      </div>

      <code className="text-[10px] text-muted-foreground font-mono truncate block">
        {query.query.slice(0, 60)}...
      </code>

      {query.tags.length > 0 && (
        <div className="flex gap-1 mt-0.5">
          {query.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[9px] bg-muted px-1 rounded">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**File:** `index.ts`

```typescript
export { QueryHistoryPanel } from "./QueryHistoryPanel";
export { QueryHistoryList } from "./QueryHistoryList";
export { SavedQueriesList } from "./SavedQueriesList";
```

### A.4 Sidebar Integration (Vertical Tabs)

**File:** `src/screens/workspace/components/DatabaseSidebar.tsx`

Add vertical tabs on the left side:

```typescript
// Add imports
import { useState, useEffect } from "react";
import { QueryHistoryPanel } from "@/components/QueryHistory";
import { IconDatabase, IconHistory } from "@tabler/icons-react";
import { eventBus } from "@/services/eventBus";

export function DatabaseSidebar({ ... }) {
  const [sidebarView, setSidebarView] = useState<"objects" | "queries">("objects");

  // Listen for sidebar view switch events
  useEffect(() => {
    const handleSwitchView = (payload: { view: "objects" | "queries" }) => {
      setSidebarView(payload.view);
    };

    eventBus.on("sidebar:switch-view", handleSwitchView);
    return () => eventBus.off("sidebar:switch-view", handleSwitchView);
  }, []);

  // ... existing hooks ...

  return (
    <div className="flex h-full">
      {/* Vertical Tab Bar */}
      <div className="flex flex-col border-r bg-muted/30 py-1">
        <button
          onClick={() => setSidebarView("objects")}
          title="Database Objects"
          className={cn(
            "p-2 transition-colors",
            sidebarView === "objects"
              ? "text-foreground bg-background border-l-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <IconDatabase className="h-4 w-4" />
        </button>
        <button
          onClick={() => setSidebarView("queries")}
          title="Query History"
          className={cn(
            "p-2 transition-colors",
            sidebarView === "queries"
              ? "text-foreground bg-background border-l-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <IconHistory className="h-4 w-4" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {sidebarView === "objects" ? (
          // Existing sidebar content
          <>
            <div className="p-1">
              {/* existing search */}
            </div>
            <div className="flex-1 relative min-h-0 overflow-auto">
              {/* existing tables/views/functions */}
            </div>
          </>
        ) : (
          <QueryHistoryPanel />
        )}
      </div>

      {/* Dialogs stay outside */}
      {truncateDialog && <TruncateTableDialog ... />}
      {deleteDialog && <DeleteTableDialog ... />}
      {duplicateDialog && <DuplicateTableDialog ... />}
    </div>
  );
}
```

### A.5 Auto-tracking Integration

**File:** `src/services/queryTracker.ts`

```typescript
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { hashString } from "@/components/CodeEditor/languages/sql/shared";
import type { QuerySource } from "@/lib/db/queryHistory";

interface TrackQueryParams {
  query: string;
  connectionId: string;
  database: string;
  schema?: string;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
  source: QuerySource;
}

// Debounce duplicate queries
const recentQueries = new Map<string, number>();
const DEBOUNCE_MS = 1000;
const MAX_CACHE_SIZE = 100;

export async function trackQuery(params: TrackQueryParams): Promise<void> {
  // Hash query for efficient dedup key
  const queryHash = hashString(params.query);
  const key = `${params.connectionId}:${queryHash}`;

  const lastRun = recentQueries.get(key);
  if (lastRun && Date.now() - lastRun < DEBOUNCE_MS) {
    return; // Skip duplicate
  }

  // Prevent unbounded growth
  if (recentQueries.size > MAX_CACHE_SIZE) {
    const entries = [...recentQueries.entries()]
      .sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < MAX_CACHE_SIZE / 2; i++) {
      recentQueries.delete(entries[i][0]);
    }
  }

  recentQueries.set(key, Date.now());

  // Get stable profileId
  const connection = useConnectionStore.getState().getConnection(params.connectionId);
  if (!connection) return;

  await useQueryHistoryStore.getState().trackExecution({
    ...params,
    profileId: connection.profile.id,
  });
}

/**
 * Wrapper for easy tracking
 */
export function withTracking<T>(
  executeFn: () => Promise<T>,
  params: Omit<TrackQueryParams, "success" | "error" | "executionTimeMs">
): Promise<T> {
  const startTime = performance.now();

  return executeFn()
    .then((result) => {
      trackQuery({
        ...params,
        success: true,
        executionTimeMs: Math.round(performance.now() - startTime),
      });
      return result;
    })
    .catch((error) => {
      trackQuery({
        ...params,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Math.round(performance.now() - startTime),
      });
      throw error;
    });
}
```

**Integration in QueryPanel.tsx:**

```typescript
import { trackQuery } from "@/services/queryTracker";

// After query execution (success or failure):
await trackQuery({
  query: sql,
  connectionId,
  database,
  schema: selectedSchema,
  executionTimeMs,
  rowCount: result.totalRows,
  success: true,
  source: "editor",
});
```

### A.6 Command Palette Commands

**File:** `src/data/defaultCommands.ts`

```typescript
{
  id: "query.history.show",
  label: "Show Query History",
  category: "Query",
  handler: () => {
    eventBus.emit("sidebar:switch-view", { view: "queries" });
    useWorkspaceScreenStore.getState().setSidebarOpen("left", true);
  },
},

{
  id: "query.history.search",
  label: "Search Query History",
  category: "Query",
  handler: () => {
    eventBus.emit("sidebar:switch-view", { view: "queries" });
    useWorkspaceScreenStore.getState().setSidebarOpen("left", true);
    setTimeout(() => {
      eventBus.emit("query-history:focus-search");
    }, 100);
  },
},

{
  id: "query.history.clear",
  label: "Clear Query History",
  category: "Query",
  handler: async () => {
    // Show confirmation dialog first
    await useQueryHistoryStore.getState().clearHistory();
    toast.success("Query history cleared");
  },
},

{
  id: "query.saved.create",
  label: "Save Current Query",
  category: "Query",
  when: "editorTextFocus && queryEditor",
  handler: () => {
    eventBus.emit("query-editor:save-current");
  },
},

{
  id: "query.saved.open",
  label: "Open Saved Query",
  category: "Query",
  handler: () => {
    eventBus.emit("sidebar:switch-view", { view: "queries" });
    useWorkspaceScreenStore.getState().setSidebarOpen("left", true);
    useQueryHistoryStore.getState().setActiveTab("saved");
  },
},
```

**File:** `src/data/defaultKeybindings.ts`

```typescript
{
  key: "mod+shift+h",
  command: "query.history.show",
},

{
  key: "mod+shift+s",
  command: "query.saved.create",
  when: "editorTextFocus && queryEditor",
},
```

---

## Implementation Order

1. **D: Autocomplete popup** (~15 min) - Single import + one line
2. **C: Formatter cursor** (~1 hour) - Token-based mapping
3. **B: Multi-connection Cmd+T** (~45 min) - Nested mode + handler
4. **A: Query History** (~4-6 hours) - Full system
   - A.1: Database schema
   - A.2: Zustand store
   - A.3: UI components
   - A.4: Sidebar integration
   - A.5: Auto-tracking
   - A.6: Commands

---

## Files to Create

| File | Feature |
|------|---------|
| `src/lib/db/queryHistory.ts` | A.1 |
| `src/stores/queryHistoryStore.ts` | A.2 |
| `src/components/QueryHistory/QueryHistoryPanel.tsx` | A.3 |
| `src/components/QueryHistory/QueryHistoryList.tsx` | A.3 |
| `src/components/QueryHistory/SavedQueriesList.tsx` | A.3 |
| `src/components/QueryHistory/index.ts` | A.3 |
| `src/services/queryTracker.ts` | A.5 |

## Files to Modify

| File | Feature |
|------|---------|
| `src/components/CodeEditor/SqlEditor.tsx` | D |
| `src/components/CodeEditor/extensions/formatter.ts` | C |
| `src/stores/ui/commandPaletteStore.ts` | B |
| `src/data/defaultCommands.ts` | B, A.6 |
| `src/components/CommandPalette/CommandPalette.tsx` | B |
| `src/screens/workspace/components/DatabaseSidebar.tsx` | A.4 |
| `src/data/defaultKeybindings.ts` | A.6 |
| `src/components/QueryPanel/QueryPanel.tsx` | A.5 |
