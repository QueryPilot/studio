# DocumentDataGrid Toolbar Redesign

## Problem

The DocumentDataGrid toolbar has 9 features in a multi-row layout. Several are broken (AI Filter stub, ObjectId Jump with wrong BSON types), misplaced (New Collection button), or low-value (schema badges, Saved Views with `window.prompt()`). The toolbar needs to be stripped to essentials and enhanced with two new capabilities.

## Features Removed

- **AI Filter button** — stub showing a toast, `generateAIFilter` never wired
- **ObjectId Jump** — broken BSON ObjectId coercion, UI state diverges from active filter
- **New Collection button** — creates new collection, unrelated to browsing current one
- **Schema sample badges** — always visible when flatten on, clutters toolbar
- **Saved Views** — `window.prompt()`, localStorage keyed by unstable `gridId`
- **Explain button** — single-line hint output, same icon as Flatten

## Features Kept

1. **BreadcrumbNav** — drill-down navigation, document paradigm essential
2. **QuickFilter** — server/client filtering via `documentFilterParser`
3. **Flatten toggle** — combined button with depth popover
4. **Inspector toggle** — global behavior across all paradigm grids

## Layout

### Root Level (Single Row)

```
[QuickFilter (server+client modes)...........] [Nested v] [inspector]
```

QuickFilter fills available space. Flatten control and inspector toggle on the right.

### Nested Array (BreadcrumbNav Row + Search Row)

```
collection > Doc(id) > field           [Up] [Root] [Flat v] [inspector]
[Search (client-only).....................................]
```

BreadcrumbNav appears above. QuickFilter switches to client-side search only.

### Nested Single Object (Key-Value View)

```
collection > Doc(id) > field           [Up] [Root] [Flat v] [inspector]
[Search (client-only).....................................]
+----------+-------------------------------------------+
| Key      | Value                                     |
+----------+-------------------------------------------+
| name     | "John"                                    |
| address  | {street: "...", city: "..."}  (drillable)  |
| tags     | ["admin", "user"]            (drillable)  |
+----------+-------------------------------------------+
```

When drilled into a single object (not array), render as vertical key-value pairs instead of a one-row columnar grid. Nested objects/arrays remain clickable for further drill-down.

## Flatten Combined Control

- **Inactive:** Button shows "Nested" with bracket icon, `variant="outline"`. Click toggles flatten on.
- **Active:** Button shows "Flat: {depth}" with bracket icon, `variant="default"`. Click toggles off. Chevron opens a popover with depth stepper (1-6, +/- buttons).

## Client-Side Search in Nested Views

QuickFilter stays visible in nested paths but locked to client-side search mode (no server filter modes). Filters visible rows by matching stringified cell values.

### Worker Offloading

- **Threshold:** >1000 rows delegates to web worker
- **Worker file:** `src/workers/gridSearch.worker.ts`
- **Pattern:** Raw `postMessage`/`onmessage` matching existing `selectionStats.worker.ts`
- **Interface:** Worker receives `{ id, rows, searchTerm, columns }`, returns `{ id, matchingIndices }`
- **Debounce:** 150ms on input before dispatching
- **Fallback:** <=1000 rows filters inline on main thread

## Key-Value View for Single Objects

### Detection

In `useDocumentData`, when navigated to a nested path: if the resolved target is a plain object (not array), signal key-value mode.

### Rendering

Transform the object's entries into rows with two columns (`Key`, `Value`). Uses same `GridColumnV2`/`GridRowModel` types and `BaseDataGrid`. Nested object/array values show type indicators and remain drillable via existing `canStepInto`/`stepInto` mechanism.

## State Removed

- `objectIdJump`, `planHint`, `savedViews`, `savedViewStorageKey`
- `handleSaveView`, `handleApplyView`, `handleJumpToObjectId`, `handleAnalyzeQuery`

## Imports Removed

- `IconSparkles`, `IconChevronRight`, `IconPlus`
- `Input`, `Badge`, `toast` (if unused elsewhere in file)
- `openCollectionDesigner`
- `MongoDBAdapter` (only used for explain)

## Files Modified

- `src/components/DataGrid/adapters/DocumentDataGrid.tsx` — toolbar rewrite, key-value view logic
- `src/components/DataGrid/hooks/useDocumentData.ts` — expose single-object detection for key-value mode

## Files Created

- `src/workers/gridSearch.worker.ts` — search worker for large nested datasets
- `src/components/DataGrid/components/FlattenControl.tsx` — combined flatten toggle + depth popover (if >40 lines)
