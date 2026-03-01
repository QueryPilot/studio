# Selection Statistics Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-pill popover selection statistics with an expandable inline stats bar that shows multiple stats at a glance, supports click-to-cycle, click-to-copy, right-click context menu for toggling, and persists preferences in IndexedDB.

**Architecture:** New Zustand store for preferences (persisted via IndexedDB). Rewrite `SelectionSummary.tsx` to render inline stat chips with a context menu. Remove the Popover dependency. All existing calculation logic is preserved.

**Tech Stack:** React 19, Zustand (devtools + persist + immer), shadcn/ui ContextMenu, Decimal.js, sonner toast, Tauri clipboard

**Design doc:** `docs/plans/2026-03-01-selection-statistics-redesign-design.md`

---

### Task 1: Create the Selection Stats Preferences Store

**Files:**
- Create: `src/stores/useSelectionStatsPreferencesStore.ts`

**Step 1: Create the store file**

```typescript
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage } from "zustand/middleware";
import { createIndexedDbStorage } from "@/components/DataGrid/stores/indexedDbStorage";

export type NumericStatKey = "sum" | "avg" | "median" | "min" | "max" | "count" | "null";
export type NonNumericStatKey = "count" | "unique" | "null";

const DEFAULT_NUMERIC_STATS: NumericStatKey[] = ["sum", "avg", "count"];
const DEFAULT_NON_NUMERIC_STATS: NonNumericStatKey[] = ["count", "unique"];

interface SelectionStatsPreferencesState {
  enabledNumericStats: NumericStatKey[];
  enabledNonNumericStats: NonNumericStatKey[];
  isExpanded: boolean;

  toggleNumericStat: (stat: NumericStatKey) => void;
  toggleNonNumericStat: (stat: NonNumericStatKey) => void;
  setExpanded: (expanded: boolean) => void;
  resetToDefaults: () => void;
}

const storage = createJSONStorage(() =>
  createIndexedDbStorage("selection-stats-preferences")
);

export const useSelectionStatsPreferencesStore = create<SelectionStatsPreferencesState>()(
  devtools(
    persist(
      immer((set) => ({
        enabledNumericStats: [...DEFAULT_NUMERIC_STATS],
        enabledNonNumericStats: [...DEFAULT_NON_NUMERIC_STATS],
        isExpanded: true,

        toggleNumericStat: (stat) => {
          set((state) => {
            const idx = state.enabledNumericStats.indexOf(stat);
            if (idx >= 0) {
              // Don't allow removing the last stat
              if (state.enabledNumericStats.length > 1) {
                state.enabledNumericStats.splice(idx, 1);
              }
            } else {
              state.enabledNumericStats.push(stat);
            }
          }, false, "selectionStats/toggleNumericStat");
        },

        toggleNonNumericStat: (stat) => {
          set((state) => {
            const idx = state.enabledNonNumericStats.indexOf(stat);
            if (idx >= 0) {
              if (state.enabledNonNumericStats.length > 1) {
                state.enabledNonNumericStats.splice(idx, 1);
              }
            } else {
              state.enabledNonNumericStats.push(stat);
            }
          }, false, "selectionStats/toggleNonNumericStat");
        },

        setExpanded: (expanded) => {
          set((state) => {
            state.isExpanded = expanded;
          }, false, "selectionStats/setExpanded");
        },

        resetToDefaults: () => {
          set((state) => {
            state.enabledNumericStats = [...DEFAULT_NUMERIC_STATS];
            state.enabledNonNumericStats = [...DEFAULT_NON_NUMERIC_STATS];
            state.isExpanded = true;
          }, false, "selectionStats/resetToDefaults");
        },
      })),
      {
        name: "selection-stats-preferences",
        storage,
        version: 1,
        partialize: (state) => ({
          enabledNumericStats: state.enabledNumericStats,
          enabledNonNumericStats: state.enabledNonNumericStats,
          isExpanded: state.isExpanded,
        }),
      },
    ),
  ),
);
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: No new errors related to the store file.

**Step 3: Commit**

```bash
git add src/stores/useSelectionStatsPreferencesStore.ts
git commit -m "feat(selection-stats): add preferences store with IndexedDB persistence"
```

---

### Task 2: Rewrite SelectionSummary Component — Expanded Inline Stats Bar

**Files:**
- Modify: `src/components/DataGrid/components/SelectionSummary.tsx` (full rewrite)

**Reference files to read before starting:**
- `src/components/DataGrid/stores/embeddedFKPreferencesStore.ts` — store pattern
- `src/components/ui/context-menu.tsx` — available context menu primitives
- `src/lib/clipboard.ts` — clipboard utility
- Current `SelectionSummary.tsx` — preserve the `Statistics` interface and `useMemo` calculation logic exactly

**Step 1: Rewrite SelectionSummary.tsx**

The new component structure:

```typescript
// Keep ALL existing imports for statistics calculation:
// memo, useMemo, useState, Decimal, isNumericColumnType, toDecimal,
// formatDecimalWithLocale, getNumericCategory, NumericCategory, GridSelection

// Remove: Popover imports
// Add new imports:
import { useCallback } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import {
  useSelectionStatsPreferencesStore,
  type NumericStatKey,
  type NonNumericStatKey,
} from "@/stores/useSelectionStatsPreferencesStore";
```

Keep the exact same `SelectionSummaryProps`, `Statistics` interface, `calculateMedian`, and the entire `useMemo` block that computes statistics. Only the **render JSX** changes.

**Stat display config (add above the component):**

```typescript
const NUMERIC_STAT_ORDER: NumericStatKey[] = ["sum", "avg", "median", "min", "max", "count", "null"];
const NON_NUMERIC_STAT_ORDER: NonNumericStatKey[] = ["count", "unique", "null"];

const NUMERIC_STAT_LABELS: Record<NumericStatKey, string> = {
  sum: "Sum", avg: "Avg", median: "Median", min: "Min", max: "Max", count: "Count", null: "Null",
};

const NON_NUMERIC_STAT_LABELS: Record<NonNumericStatKey, string> = {
  count: "Count", unique: "Unique", null: "Null",
};

// Cycle order for click-on-label: only the "swappable" numeric stats
const NUMERIC_CYCLE_ORDER: NumericStatKey[] = ["sum", "avg", "median", "min", "max"];
```

**New render logic inside the component (replace everything after the `useMemo` and `formatNumber`):**

```tsx
const {
  enabledNumericStats,
  enabledNonNumericStats,
  isExpanded,
  toggleNumericStat,
  toggleNonNumericStat,
  setExpanded,
  resetToDefaults,
} = useSelectionStatsPreferencesStore();

// Get the stat value by key
const getStatValue = useCallback(
  (key: string): string | null => {
    if (!statistics) return null;
    switch (key) {
      case "sum": return statistics.sum ? formatNumber(statistics.sum) : null;
      case "avg": return statistics.avg ? formatNumber(statistics.avg) : null;
      case "median": return statistics.median ? formatNumber(statistics.median) : null;
      case "min": return statistics.min ? formatNumber(statistics.min) : null;
      case "max": return statistics.max ? formatNumber(statistics.max) : null;
      case "count": return statistics.count.toLocaleString();
      case "unique": return statistics.countUnique?.toLocaleString() ?? null;
      case "null": return statistics.countNull && statistics.countNull > 0
        ? statistics.countNull.toLocaleString() : null;
      default: return null;
    }
  },
  [statistics, formatNumber],
);

// Filter to stats that have values and are enabled
const visibleStats = useMemo(() => {
  if (!statistics) return [];
  const order = statistics.isNumeric ? NUMERIC_STAT_ORDER : NON_NUMERIC_STAT_ORDER;
  const enabled = statistics.isNumeric ? enabledNumericStats : enabledNonNumericStats;
  return order
    .filter((key) => enabled.includes(key as never))
    .map((key) => ({
      key,
      label: statistics.isNumeric
        ? NUMERIC_STAT_LABELS[key as NumericStatKey]
        : NON_NUMERIC_STAT_LABELS[key as NonNumericStatKey],
      value: getStatValue(key),
    }))
    .filter((s) => s.value !== null);
}, [statistics, enabledNumericStats, enabledNonNumericStats, getStatValue]);

// Handle click-to-copy
const handleCopyValue = useCallback((value: string) => {
  void writeClipboardText(value).then(() => {
    toast.success("Copied to clipboard");
  });
}, []);

// Handle click-on-label to cycle (numeric only)
const handleCycleStat = useCallback(
  (currentKey: string) => {
    if (!statistics?.isNumeric) return;
    const cycleIdx = NUMERIC_CYCLE_ORDER.indexOf(currentKey as NumericStatKey);
    if (cycleIdx < 0) return; // "count" and "null" don't cycle

    // Find next stat in cycle that has a value
    for (let i = 1; i <= NUMERIC_CYCLE_ORDER.length; i++) {
      const nextKey = NUMERIC_CYCLE_ORDER[(cycleIdx + i) % NUMERIC_CYCLE_ORDER.length];
      // Enable the next one and disable the current one
      if (!enabledNumericStats.includes(nextKey)) {
        toggleNumericStat(nextKey);    // enable new
      }
      if (enabledNumericStats.includes(currentKey as NumericStatKey) && currentKey !== nextKey) {
        toggleNumericStat(currentKey as NumericStatKey); // disable old
      }
      break;
    }
  },
  [statistics, enabledNumericStats, toggleNumericStat],
);

if (!statistics || visibleStats.length === 0) return null;

const isNumeric = statistics.isNumeric;
const primaryStat = visibleStats[0];

// Context menu items for toggling
const allStatKeys = isNumeric ? NUMERIC_STAT_ORDER : NON_NUMERIC_STAT_ORDER;
const allStatLabels = isNumeric ? NUMERIC_STAT_LABELS : NON_NUMERIC_STAT_LABELS;
const enabledStats = isNumeric ? enabledNumericStats : enabledNonNumericStats;
const toggleStat = isNumeric
  ? (key: string) => toggleNumericStat(key as NumericStatKey)
  : (key: string) => toggleNonNumericStat(key as NonNumericStatKey);

return (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div
        className={cn(
          "flex items-center rounded-md border transition-colors",
          isNumeric
            ? "bg-green-500/10 border-green-500/20"
            : "bg-blue-500/10 border-blue-500/20",
          className,
        )}
      >
        {isExpanded ? (
          <>
            {/* Expanded: show all visible stats inline */}
            {visibleStats.map((stat, idx) => (
              <div key={stat.key} className="flex items-center">
                {idx > 0 && (
                  <div
                    className={cn(
                      "w-px h-3.5 self-center",
                      isNumeric ? "bg-green-500/20" : "bg-blue-500/20",
                    )}
                  />
                )}
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 h-6 text-xs",
                    isNumeric
                      ? "text-green-700 dark:text-green-400"
                      : "text-blue-700 dark:text-blue-400",
                  )}
                >
                  <span
                    className="text-muted-foreground cursor-pointer hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCycleStat(stat.key);
                    }}
                  >
                    {stat.label}:
                  </span>
                  <span
                    className="font-mono font-medium cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyValue(stat.value!);
                    }}
                    title="Click to copy"
                  >
                    {stat.value}
                  </span>
                </div>
              </div>
            ))}
            {/* Collapse chevron */}
            <button
              className={cn(
                "flex items-center justify-center w-5 h-6 rounded-r-md transition-colors",
                isNumeric
                  ? "text-green-700/60 dark:text-green-400/60 hover:bg-green-500/20"
                  : "text-blue-700/60 dark:text-blue-400/60 hover:bg-blue-500/20",
              )}
              onClick={() => setExpanded(false)}
              title="Collapse"
            >
              <IconChevronLeft className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            {/* Compact: show only primary stat */}
            {primaryStat && (
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 h-6 text-xs",
                  isNumeric
                    ? "text-green-700 dark:text-green-400"
                    : "text-blue-700 dark:text-blue-400",
                )}
              >
                <span className="text-muted-foreground">{primaryStat.label}:</span>
                <span
                  className="font-mono font-medium cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyValue(primaryStat.value!);
                  }}
                  title="Click to copy"
                >
                  {primaryStat.value}
                </span>
              </div>
            )}
            {/* Expand chevron */}
            <button
              className={cn(
                "flex items-center justify-center w-5 h-6 rounded-r-md transition-colors",
                isNumeric
                  ? "text-green-700/60 dark:text-green-400/60 hover:bg-green-500/20"
                  : "text-blue-700/60 dark:text-blue-400/60 hover:bg-blue-500/20",
              )}
              onClick={() => setExpanded(true)}
              title="Expand"
            >
              <IconChevronRight className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent className="w-48 text-xs p-1">
      {allStatKeys.map((key) => {
        // Skip "null" for non-numeric if there are no nulls
        if (key === "null" && !statistics.countNull) return null;
        return (
          <ContextMenuCheckboxItem
            key={key}
            checked={enabledStats.includes(key as never)}
            onCheckedChange={() => toggleStat(key)}
          >
            {allStatLabels[key as keyof typeof allStatLabels]}
          </ContextMenuCheckboxItem>
        );
      })}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={resetToDefaults}>
        Reset to Defaults
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors.

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/components/DataGrid/components/SelectionSummary.tsx
git commit -m "feat(selection-stats): rewrite as expandable inline stats bar with context menu"
```

---

### Task 3: Visual Polish and Edge Cases

**Files:**
- Modify: `src/components/DataGrid/components/SelectionSummary.tsx`

**Step 1: Handle edge cases**

Add these refinements to the component:

1. **Large selection (>5000 cells)**: When only `count` is available (no sum/avg/median), show just `Count: N` — the existing threshold logic already returns `{ count, isNumeric: false }`. The new UI handles this automatically since only "count" will have a non-null value.

2. **Tooltip on stat value hover**: Add `title` attributes showing the full unformatted number (for truncated large numbers). Already included in the plan above via `title="Click to copy"` — update to show the actual value: `title={stat.value + " — click to copy"}`.

3. **Animate expand/collapse**: Add a smooth transition. Wrap the stats container in a `div` with `overflow-hidden` and use CSS `transition: max-width`. Or keep it simple with no animation for now (instant toggle).

**Step 2: Test manually**

1. Open the app with `make dev`
2. Open a table with numeric columns
3. Select multiple cells in a numeric column
4. Verify expanded stats bar shows (green, multiple stats inline)
5. Click a value — verify it copies to clipboard and shows toast
6. Click a label (e.g., "Sum") — verify it cycles to "Avg"
7. Right-click the stats area — verify context menu with checkboxes
8. Toggle a stat off — verify it disappears
9. Click collapse chevron — verify compact mode with one stat
10. Click expand chevron — verify all stats return
11. Reload the page — verify preferences persist
12. Select non-numeric cells — verify blue stats (Count, Unique)
13. Right-click and "Reset to Defaults" — verify reset works

**Step 3: Run verification**

Run: `pnpm typecheck && pnpm lint`
Expected: Clean.

**Step 4: Commit**

```bash
git add src/components/DataGrid/components/SelectionSummary.tsx
git commit -m "feat(selection-stats): add polish, edge cases, and tooltips"
```

---

### Task 4: Clean Up and Final Verification

**Files:**
- Modify: `src/components/DataGrid/components/SelectionSummary.tsx` — remove any unused imports
- Check: `src/components/DataGrid/components/DataGridStatusBar.tsx` — no changes needed (props unchanged)

**Step 1: Remove dead code**

- Remove the Popover import if still present
- Remove any unused state (`isOpen`, `setIsOpen` from old implementation)
- Verify `SelectionSummaryProps` interface is unchanged (DataGridStatusBar passes the same props)

**Step 2: Full verification**

Run: `pnpm typecheck && pnpm lint`
Expected: Clean, no new errors.

**Step 3: Final commit**

```bash
git add -u
git commit -m "refactor(selection-stats): clean up unused imports and dead code"
```
