# Selection Statistics Redesign

## Problem

The current selection statistics UI is a single green pill ("Sum: 43") that requires clicking to reveal a popover with all stats. This has three issues:

1. **Too hidden** — users must click to see stats, adding friction
2. **Looks basic** — the pill+popover feels like an afterthought
3. **Not interactive** — no way to customize visible stats, copy values, or personalize

## Design: Expandable Inline Stats Bar

### Visual Layout

**Expanded state (default):**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Sum: 43  │  Avg: 8.6  │  Count: 5  │  Min: 2  │  Max: 15  ◂    250 rows │
└──────────────────────────────────────────────────────────────────────────────┘
```

- All enabled stats shown inline, separated by subtle vertical dividers
- Collapse chevron (◂) at right edge of stats group
- Unified tinted background: green for numeric, blue for non-numeric
- Label in muted text, value in monospace font

**Compact state (user-collapsed):**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [Sum: 43 ▸]                                                     250 rows │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Shows only primary stat (first enabled stat) in a pill
- Expand chevron (▸) to restore expanded view

**Non-numeric selection:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Count: 12  │  Unique: 8  │  Null: 1  ◂                         250 rows │
└──────────────────────────────────────────────────────────────────────────────┘
```

Blue-tinted background with Count, Unique, Null stats.

### Interactions

1. **Click a stat value** → copies value to clipboard (brief flash feedback)
2. **Click the chevron** (◂/▸) → toggles expanded/compact
3. **Click a stat label** (e.g. "Sum") → cycles to next stat in group (Sum→Avg→Median→Min→Max→Sum)
4. **Right-click stats area** → context menu to toggle stats on/off:

```
┌─────────────────────────┐
│  ✓ Sum                  │
│  ✓ Average              │
│    Median               │
│  ✓ Min                  │
│  ✓ Max                  │
│  ✓ Count                │
│    Null Count           │
│ ─────────────────────── │
│    Reset to Defaults    │
└─────────────────────────┘
```

- At least one stat must remain enabled
- "Reset to Defaults" restores factory defaults

### Persistence

New Zustand store with IndexedDB persistence (`useSelectionStatsPreferencesStore`):

```typescript
{
  enabledNumericStats: ['sum', 'avg', 'count'],     // defaults
  enabledNonNumericStats: ['count', 'unique'],       // defaults
  isExpanded: true,                                   // default: expanded
}
```

Global preferences (same across all connections/tables).

### Defaults

- **Numeric**: Sum, Avg, Count (3 stats)
- **Non-numeric**: Count, Unique (2 stats)

### Stat Ordering

Fixed render order regardless of toggle order:
- Numeric: Sum → Avg → Median → Min → Max → Count → Null
- Non-numeric: Count → Unique → Null

### Technical Notes

- Replaces current `SelectionSummary.tsx` component
- Removes the Popover dependency (no longer needed)
- Reuses existing statistics calculation logic (memoized in useMemo)
- Same performance thresholds: 5k cells for expensive stats, 10k rows for status bar skip
- Context menu built with existing shadcn/ui ContextMenu or DropdownMenu
- Existing `numericPrecision.ts` utilities unchanged

## Files Affected

- `src/components/DataGrid/components/SelectionSummary.tsx` — full rewrite
- `src/components/DataGrid/components/DataGridStatusBar.tsx` — minor prop changes if any
- New: `src/stores/useSelectionStatsPreferencesStore.ts` — preference persistence
