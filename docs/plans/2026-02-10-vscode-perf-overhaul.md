# VS Code-Level Performance Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve VS Code-level performance in QueryPilot's editor grid/tabs/panel system by eliminating re-render storms, reducing IPC overhead, and implementing focus-gated extension lifecycle.

**Architecture:** Modeled on validated VS Code patterns: store isolation prevents cross-panel re-renders, focus-gated extensions eliminate wasted work in unfocused editors, a shared linter coordinator deduplicates IPC, and layout caching prevents unnecessary DOM recalculations. Each phase is independently shippable and measurable.

**Tech Stack:** React 19, Zustand, CodeMirror 6, Tauri IPC, react-resizable-panels

---

## Architecture Overview

### Current Architecture (Before)

```
┌─────────────────────────────────────────────────────────────────┐
│  WorkbenchLayout                                                │
│  useWorkbenchStore() ← subscribes to EVERYTHING                 │
│  (layoutTree, panelContents, focusedPanelId, moveTab, ...)      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PanelPortalProvider                                      │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  GridRenderer (recursive binary tree)               │  │  │
│  │  │  Subscribes: resizePanelAction                      │  │  │
│  │  │                                                     │  │  │
│  │  │  ┌──────────────┐     ┌──────────────┐              │  │  │
│  │  │  │ PanelContainer│     │ PanelContainer│             │  │  │
│  │  │  │ (portal slot) │     │ (portal slot) │             │  │  │
│  │  │  └──────────────┘     └──────────────┘              │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌─── PanelPortal (A) ───┐  ┌─── PanelPortal (B) ───┐   │  │
│  │  │ style={top,left,w,h}  │  │ style={top,left,w,h}  │   │  │
│  │  │ ← useState(rect) ─────│──│─── re-renders on       │   │  │
│  │  │    re-renders on       │  │    every resize!       │   │  │
│  │  │    every resize!       │  │                        │   │  │
│  │  │  ┌─────────────────┐  │  │  ┌─────────────────┐   │   │  │
│  │  │  │ Panel + Tabs    │  │  │  │ Panel + Tabs    │   │   │  │
│  │  │  │ ┌─────────────┐ │  │  │  │ ┌─────────────┐ │   │   │  │
│  │  │  │ │ PanelContent │ │  │  │  │ │ PanelContent │ │   │   │  │
│  │  │  │ │ Renderer     │ │  │  │  │ │ Renderer     │ │   │   │  │
│  │  │  │ │ subscribes:  │ │  │  │  │ │ subscribes:  │ │   │   │  │
│  │  │  │ │ focusedPanel │ │  │  │  │ │ focusedPanel │ │   │   │  │
│  │  │  │ │ Id (ALL re-  │ │  │  │  │ │ Id (ALL re-  │ │   │   │  │
│  │  │  │ │ render on    │ │  │  │  │ │ render on    │ │   │   │  │
│  │  │  │ │ any focus    │ │  │  │  │ │ any focus    │ │   │   │  │
│  │  │  │ │ change!)     │ │  │  │  │ │ change!)     │ │   │   │  │
│  │  │  │ └─────────────┘ │  │  │  │ └─────────────┘ │   │   │  │
│  │  │  └─────────────────┘  │  │  └─────────────────┘   │   │  │
│  │  └───────────────────────┘  └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

                    workbenchStore (MONOLITHIC)
┌─────────────────────────────────────────────────────────────────┐
│ layoutTree ──┐                                                  │
│ panelContents ├── ANY change → new snapshot → ALL re-render     │
│ focusedPanelId┘                                                 │
│ dragDropContext                                                  │
│ layoutHistory                                                   │
│ activeConnectionId                                              │
└─────────────────────────────────────────────────────────────────┘

      CodeMirror Editor Instances (per panel)
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ SqlEditor A      │  │ SqlEditor B      │  │ SqlEditor C      │
│ (FOCUSED)        │  │ (unfocused)      │  │ (unfocused)      │
│                  │  │                  │  │                  │
│ 20+ extensions   │  │ 20+ extensions   │  │ 20+ extensions   │
│ ALL eager load   │  │ ALL eager load   │  │ ALL eager load   │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ run-gutter   │ │  │ │ run-gutter   │ │  │ │ run-gutter   │ │
│ │ StateField:  │ │  │ │ StateField:  │ │  │ │ StateField:  │ │
│ │ getAllStmts()│ │  │ │ getAllStmts()│ │  │ │ getAllStmts()│ │
│ │ on EVERY     │ │  │ │ on EVERY     │ │  │ │ on EVERY     │ │
│ │ docChanged!  │ │  │ │ docChanged!  │ │  │ │ docChanged!  │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ unified-     │ │  │ │ unified-     │ │  │ │ unified-     │ │
│ │ linter       │ │  │ │ linter       │ │  │ │ linter       │ │
│ │ OWN IPC call │ │  │ │ OWN IPC call │ │  │ │ OWN IPC call │ │
│ │ sql_validate │ │  │ │ sql_validate │ │  │ │ sql_validate │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ Global cache │ │  │ │ Global cache │ │  │ │ Global cache │ │
│ │ (singleton)  │ │  │ │ (thrashes!)  │ │  │ │ (thrashes!)  │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
└──────────────────┘  └──────────────────┘  └──────────────────┘
   ↕ IPC                ↕ IPC                ↕ IPC
   sql_validate          sql_validate          sql_validate
   (duplicate!)          (duplicate!)          (duplicate!)
```

**Key problems:**
- Monolithic store: any state change re-renders everything
- All editors run all extensions eagerly, even unfocused ones
- `run-gutter` StateField parses SQL in ALL editors on every keystroke
- Each editor makes its own IPC calls (3x duplicate work with 3 panels)
- Global statement cache thrashes between editors
- `PanelPortal` re-renders on every resize via `useState(rect)`

---

### Tab Type Inventory

QueryPilot has **11 distinct tab types** — not just SQL editors. The performance plan must account for all of them:

| Tab Type | Component | Editor | Mount Cost | Store Subs | Focus |
|----------|-----------|--------|------------|------------|-------|
| `query` | `QueryPanel` → `SqlEditor` | CM6 (20+ ext) | HIGH | 4 stores | Yes |
| `mongo-query` | `MongoQueryPanel` → 2x `CodeEditor` | CM6 (light) | MODERATE | None | No |
| `redis-cli` | `RedisCliPanel` | Plain Input | MODERATE | None | No |
| `table` → data | `SqlDataGrid` (Glide) | None | MODERATE-HIGH | Limited | Prop |
| `table` → structure | `TableStructure` (DataGridBase) | None | HIGH | 3 stores | No |
| `table` → indexes | `TableIndexes` (DataGridBase) | None | MODERATE | 1 store | No |
| `table` → triggers | `TableTriggers` (DataGridBase) | None | MODERATE | None | No |
| `table` → partitions | `TablePartitions` (DataGridBase) | None | LOW | 1 store | No |
| `table` → definition | `ObjectDefinition` → `CodeEditor` | CM6 (read-only) | MODERATE | 1 store | No |
| `function` | `ObjectDefinition` → `CodeEditor` | CM6 (read-only) | MODERATE | 1 store | No |
| `erd` | `ERDPanel` → `CodeEditor` + ReactFlow | CM6 (DBML) | VERY HIGH | 2 stores | No |
| `design` | `TableDesigner` (DataGridBase) | None | MODERATE | 3 stores | Input |
| `mongo-collection` | `DocumentDataGrid` (Glide) | None | MODERATE | Limited | Prop |
| `redis-key` | `KeyValueDataGrid` (Glide) | None | MODERATE | Limited | Prop |

**Which optimizations apply where:**

| Optimization | Applies To |
|-------------|-----------|
| Store isolation (Phase 0-1) | **ALL tab types** — every panel benefits from fewer re-renders |
| Portal positioning (Phase 4) | **ALL tab types** — every panel is in a PanelPortal |
| Extension phasing (Phase 2) | `query` (SqlEditor), `mongo-query` (CodeEditor), `erd` (CodeEditor) |
| Focus-gated StateField (Phase 0) | `query` (SqlEditor with run-gutter) |
| Linter coordinator (Phase 3) | `query` (SqlEditor with unified-linter) |
| Deferred compartments (Phase 5) | `query` (SqlEditor), `mongo-query` (CodeEditor) |
| LRU cache (Phase 6) | `query` (SqlEditor with getAllStatements) |
| Lightbulb optimization (Phase 7) | `query` (SqlEditor with refactoring) |

> **Note:** `CodeEditor` (used by MongoQueryPanel, ObjectDefinition, ERDPanel) is a lighter
> wrapper using `@uiw/react-codemirror` with ~10 extensions. It does NOT have run-gutter,
> unified-linter, refactoring, or statement-highlight extensions. It still benefits from
> store isolation and extension phasing but doesn't need the CM6-specific hot fixes in Phase 0.

---

### Target Architecture (After)

```
┌─────────────────────────────────────────────────────────────────┐
│  WorkbenchLayout                                                │
│  useWorkbenchStore((s) => s.layoutTree) ← layout ONLY           │
│  usePanelFocusStore((s) => s.focusedPanelId) ← focus ONLY      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PanelPortalProvider                                      │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  GridRenderer (recursive binary tree)               │  │  │
│  │  │  RAF-debounced resize → store                       │  │  │
│  │  │                                                     │  │  │
│  │  │  ┌──────────────┐     ┌──────────────┐              │  │  │
│  │  │  │ PanelContainer│     │ PanelContainer│             │  │  │
│  │  │  └──────────────┘     └──────────────┘              │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌─── PanelPortal (A) ───┐  ┌─── PanelPortal (B) ───┐   │  │
│  │  │ ref-based positioning  │  │ ref-based positioning  │   │  │
│  │  │ ← direct DOM mutation  │  │ ← direct DOM mutation  │   │  │
│  │  │   ZERO re-renders      │  │   ZERO re-renders      │   │  │
│  │  │   during resize!       │  │   during resize!       │   │  │
│  │  │                        │  │                        │   │  │
│  │  │  ┌─────────────────┐  │  │  ┌─────────────────┐   │   │  │
│  │  │  │ Panel + Tabs    │  │  │  │ Panel + Tabs    │   │   │  │
│  │  │  │ ┌─────────────┐ │  │  │  │ ┌─────────────┐ │   │   │  │
│  │  │  │ │ PanelContent │ │  │  │  │ │ PanelContent │ │   │   │  │
│  │  │  │ │ Renderer     │ │  │  │  │ │ Renderer     │ │   │   │  │
│  │  │  │ │ subscribes:  │ │  │  │  │ │ subscribes:  │ │   │   │  │
│  │  │  │ │ isPanelFocus │ │  │  │  │ │ isPanelFocus │ │   │   │  │
│  │  │  │ │ ed (boolean) │ │  │  │  │ │ ed (boolean) │ │   │   │  │
│  │  │  │ │ ONLY re-     │ │  │  │  │ │ NO re-render │ │   │   │  │
│  │  │  │ │ renders when │ │  │  │  │ │ when A↔B     │ │   │   │  │
│  │  │  │ │ THIS panel   │ │  │  │  │ │ focus switch │ │   │   │  │
│  │  │  │ │ focus flips  │ │  │  │  │ │ (stays false)│ │   │   │  │
│  │  │  │ └─────────────┘ │  │  │  │ └─────────────┘ │   │   │  │
│  │  │  └─────────────────┘  │  │  └─────────────────┘   │   │  │
│  │  └───────────────────────┘  └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

                     ISOLATED STORES
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ workbenchStore   │  │ panelFocusStore  │  │ (existing stores)│
│ layoutTree       │  │ focusedPanelId   │  │ tabStateStore    │
│ panelContents    │  │ focusPanel()     │  │ connectionStore  │
│ (layout ONLY)    │  │ (focus ONLY)     │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
  ↑ only GridRenderer    ↑ only Panel         Granular selectors
    subscribes             border logic        usePanelContent()

      CodeMirror Editor Instances (per panel)
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ SqlEditor A      │  │ SqlEditor B      │  │ SqlEditor C      │
│ (FOCUSED)        │  │ (unfocused)      │  │ (unfocused)      │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ EAGER exts   │ │  │ │ EAGER exts   │ │  │ │ EAGER exts   │ │
│ │ (12 core)    │ │  │ │ (12 core)    │ │  │ │ (12 core)    │ │
│ ├──────────────┤ │  │ ├──────────────┤ │  │ ├──────────────┤ │
│ │ Phase 1 exts │ │  │ │ Phase 1 exts │ │  │ │ Phase 1 exts │ │
│ │ (after 1st   │ │  │ │ (after 1st   │ │  │ │ (after 1st   │ │
│ │  render)     │ │  │ │  render)     │ │  │ │  render)     │ │
│ ├──────────────┤ │  │ ├──────────────┤ │  │ ├──────────────┤ │
│ │ Phase 2 exts │ │  │ │ Phase 2 exts │ │  │ │ Phase 2 exts │ │
│ │ (after 2s)   │ │  │ │ (after 2s)   │ │  │ │ (after 2s)   │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ run-gutter   │ │  │ │ run-gutter   │ │  │ │ run-gutter   │ │
│ │ ViewPlugin:  │ │  │ │ SKIPPED      │ │  │ │ SKIPPED      │ │
│ │ focus-gated  │ │  │ │ (no focus →  │ │  │ │ (no focus →  │ │
│ │ getAllStmts()│ │  │ │  stale data)  │ │  │ │  stale data)  │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ compartments │ │  │ │ compartments │ │  │ │ compartments │ │
│ │ IMMEDIATE    │ │  │ │ DEFERRED     │ │  │ │ DEFERRED     │ │
│ │ reconfigure  │ │  │ │ (queued for  │ │  │ │ (queued for  │ │
│ │              │ │  │ │  focus)      │ │  │ │  focus)      │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
│                  │  │                  │  │                  │
│ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
│ │ LRU cache    │ │  │ │ LRU cache    │ │  │ │ LRU cache    │ │
│ │ (per-editor, │ │  │ │ (per-editor, │ │  │ │ (per-editor, │ │
│ │  no thrash)  │ │  │ │  no thrash)  │ │  │ │  no thrash)  │ │
│ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
└────────┬─────────┘  └──────────────────┘  └──────────────────┘
         │
         ↓ ONLY focused editor sends IPC
┌──────────────────────────────────────────────────────────────┐
│  LinterCoordinator (singleton)                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ Dedup by   │→ │ RAF batch  │→ │ Cache 5s   │             │
│  │ SQL hash   │  │ requests   │  │ results    │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│                       │                                      │
│                       ↓ SINGLE IPC call                      │
│                  sql_validate                                │
│                       │                                      │
│                       ↓ result shared to all subscribers     │
│                  callback(result)                            │
└──────────────────────────────────────────────────────────────┘
```

**Key improvements:**
- **Store isolation**: `panelFocusStore` separate from layout — focus changes don't re-render content
- **Boolean selectors**: `isPanelFocused` (boolean) instead of `focusedPanelId` (string) — only 2 panels re-render on focus switch, not all
- **Ref-based portal positioning**: DOM mutation during resize, zero React re-renders
- **RAF-debounced resize**: Store only updates when drag settles
- **Extension phasing**: 12 eager → 5 after first render → 8 after 2s idle
- **Focus-gated StateField**: `run-gutter` skips `getAllStatements()` for unfocused editors
- **Deferred compartments**: Theme/dialect changes queued for unfocused editors, applied on focus
- **LinterCoordinator singleton**: Deduplicates IPC by SQL hash, RAF-batches, 5s result cache
- **LRU statement cache**: Per-editor cache slots (8 max) instead of global singleton thrashing

### Data Flow Comparison

```
BEFORE: User types in Panel A (3 panels open)
─────────────────────────────────────────────
keystroke
  → CM transaction fires in A, B, C (shared doc? no, but store re-renders all)
  → run-gutter StateField: getAllStatements() × 3 editors (synchronous!)
  → unified-linter: sql_validate IPC × 3 editors (1200ms debounce each)
  → semantic-highlighting: analyzeSemanticTokens() × 3 (250ms debounce)
  → statement-highlight: getAllStatements() × 3 (100ms debounce)
  → lightbulb: getRefactorActions() IPC × 3 (150ms debounce)
  → workbenchStore: updateTabMetadata → new Map() → ALL panels re-render
Total: 9× getAllStatements, 3× IPC, ALL panels re-render

AFTER: User types in Panel A (3 panels open)
─────────────────────────────────────────────
keystroke
  → CM transaction fires in A only
  → run-gutter: ViewPlugin checks focus → A runs getAllStatements(), B+C skip
  → unified-linter: A sends to LinterCoordinator → 1 IPC call (deduplicated)
  → semantic-highlighting: A runs (focused), B+C return Decoration.none
  → statement-highlight: A runs (focused), B+C keep stale decorations
  → lightbulb: A runs (same line? skip), B+C skip (no focus)
  → panelFocusStore: no change → 0 re-renders
  → workbenchStore: updateTabMetadata → updateSinglePanel → only A re-renders
Total: 1× getAllStatements, 1× IPC, 1 panel re-renders


BEFORE: User switches focus between Panel A (query) and Panel B (table data)
──────────────────────────────────────────────────────────────────────────────
click on Panel B
  → workbenchStore.set({ focusedPanelId: panelB })
  → new store snapshot
  → PanelContentRenderer A: re-renders (focusedPanelId changed, string comparison)
  → PanelContentRenderer B: re-renders (focusedPanelId changed, string comparison)
  → PanelContentRenderer C: re-renders (focusedPanelId changed, string comparison)
  → QueryPanel in A: re-renders (isPanelFocused changed)
  → SqlDataGrid in B: re-renders (focused prop changed)
  → TableStructure in C: NOT affected (no focus tracking)
Total: 3 PanelContentRenderer re-renders + 2 child re-renders

AFTER: User switches focus between Panel A (query) and Panel B (table data)
─────────────────────────────────────────────────────────────────────────────
click on Panel B
  → panelFocusStore.set({ focusedPanelId: panelB })
  → PanelContentRenderer A: re-renders (boolean true→false)
  → PanelContentRenderer B: re-renders (boolean false→true)
  → PanelContentRenderer C: NO re-render (boolean stays false)
  → QueryPanel in A: re-renders (isPanelFocused changed)
  → SqlDataGrid in B: re-renders (focused prop changed)
Total: 2 PanelContentRenderer re-renders + 2 child re-renders (Panel C saved)
```

**ERDPanel note:** The ERD tab has VERY HIGH mount cost (fetches ALL tables + batch structure queries + DBML parsing + ReactFlow init). This is addressed by Phase 4's portal optimization (no re-mount on resize) and the store isolation (no re-render from unrelated state changes). A future phase could add lazy schema fetching for ERD, but that's out of scope for this plan.

---

### VS Code Validated Patterns Reference

These patterns were extracted from VS Code source code and verified against the actual implementation. Each maps to a specific task in this plan.

| VS Code Pattern | Source File | How We Apply It |
|----------------|-------------|-----------------|
| **Proportional layout caching** — `proportions` array caches size ratios; subsequent `layout()` calls skip priority-based distribution | `src/vs/base/browser/ui/splitview/splitview.ts` | Task 4.2: RAF-debounced resize with cached ratios |
| **State machine gating** — `State.Idle/Busy` enum prevents modifications during layout: `if (this.state !== State.Idle) throw` | `splitview.ts` | Task 4.2: Guard resize updates during layout sync |
| **`_cachedVisibleSize`** — Hidden views store previous dimensions for instantaneous show/hide | `splitview.ts` → `ViewItem` | Task 4.1: Ref-based portal positioning preserves dimensions |
| **Tab direct DOM** — `$()` helper builds hierarchical DOM; `redrawTab`/`redrawTabLabel` toggle CSS classes | `multiEditorTabsControl.ts` | N/A (React tabs are acceptable for our scale) |
| **`blockRevealActiveTab`** — Prevents scroll-to-active during rapid tab closures; auto-resets after layout | `multiEditorTabsControl.ts` | Task 0.4: Similar guard when closing panels |
| **`RunOnceScheduler` for label updates** — Batches many individual label requests into one update | `multiEditorTabsControl.ts` | Task 1.2: Batch `updateTabMetadata` calls |
| **Tab dimension caching** — "Return quickly if our used dimensions are known" | `multiEditorTabsControl.ts` | Task 4.2: Skip layout if dimensions unchanged |
| **`scheduleAtNextAnimationFrame()`** — Defers expensive DOM queries to next RAF | `src/vs/base/browser/dom.ts` | Task 4.1, 4.2: All layout updates RAF-deferred |
| **Global centralized RAF scheduler** — Two queues (NEXT/CURRENT), priority: measure (10000) > normal (0) > modify (-10000). Prevents layout thrashing | `dom.ts` | Task 3.1: LinterCoordinator uses same RAF batching |
| **EditorPane pooling** — `editorPanes[]` array; `descriptor.describes()` finds reusable pane before creating new | `editorPanes.ts` | N/A (React component reuse via portal preservation) |
| **`EditorInput.matches()`** — Reference equality for typed inputs, URI+editorId for untyped | `editorInput.ts` | Task 1.2: `usePanelContent` reference equality |
| **TextModel disposal-based lifecycle** — URI-keyed `_models` map, disposal events (NOT ref-counted). SHA-1 matching for undo stack re-attachment. 20MB memory cap | `modelService.ts` | N/A (each editor has own CodeMirror state) |
| **5-phase contribution instantiation** — Eager / AfterFirstRender (50ms) / BeforeFirstInteraction / Eventually (5000ms) / Lazy (on-demand only) | `editorCommon.ts` + Issue #166969 | Task 2.1-2.2: 3-phase extension loading |
| **Cursor hidden on blur** — `_getCursorBlinking()` returns `Hidden` when `!_editorHasFocus`. JS flat blink (500ms toggle) for battery. CSS animations after 500ms delay | `viewCursors.ts` | Task 2.3: Focus-gate semantic/statement extensions |
| **ViewPart 2-phase rendering** — `prepareRender(ctx)` then `render(ctx)`. StringBuilder batching (100K capacity). Viewport-aware, lazy DOM creation | `viewPart.ts`, `viewLayer.ts` | Informational — our extensions follow similar pattern |
| **`RunOnceWorker` batch processing** — Collects work units during delay, processes all in one batch | `async.ts` | Task 5.1: Batch deferred compartment reconfigurations |

---

## Phase 0: Critical Hot Fixes (Day 1-2)

The **HIGH severity** issues causing the worst lag with 2+ panels, plus cleanup tasks identified by codebase audit.

---

### Task 0.1: Fix run-gutter StateField Running on ALL Editors

**Problem:** `statementsField` in `run-gutter.ts` calls `getAllStatements()` synchronously on **every `docChanged` transaction** for ALL editor instances, regardless of focus. The StateField runs in the CM transaction pipeline unconditionally — the `hasFocus` guard only protects the ViewPlugin, not the StateField.

**Files:**
- Modify: `src/components/CodeEditor/extensions/run-gutter.ts:17-45`
- Test: Manual test — open 3 split panels, type rapidly, measure CPU in DevTools Performance tab

**Step 1: Add focus-awareness to the StateField**

Replace the `statementsField` (lines 17-45) with a version that skips recomputation when the editor lacks focus. Since StateFields can't directly check focus (no `view`), we'll convert the statements tracking to a ViewPlugin that only recomputes on focus:

```typescript
// Replace the StateField with a StateField that is only updated via effects
const updateStatementsEffect = StateEffect.define<Map<number, StatementBoundary>>();

const statementsField = StateField.define<Map<number, StatementBoundary>>({
  create(state) {
    const map = new Map<number, StatementBoundary>();
    if (state.doc.length === 0) return map;
    const statements = getAllStatements(state);
    statements.forEach((stmt) => {
      const lineNum = state.doc.lineAt(stmt.from).number;
      map.set(lineNum, stmt);
    });
    return map;
  },
  update(map, tr) {
    // Only update when explicitly told to via effect
    for (const effect of tr.effects) {
      if (effect.is(updateStatementsEffect)) {
        return effect.value;
      }
    }
    // If doc changed but no effect, return stale map (will be updated when focused)
    return map;
  },
});
```

Then add a lightweight ViewPlugin that dispatches the effect only when focused:

```typescript
const statementsUpdater = ViewPlugin.fromClass(
  class {
    private pendingUpdate: ReturnType<typeof setTimeout> | null = null;

    constructor(private view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      // Skip recomputation for unfocused editors
      if (!update.view.hasFocus) return;

      if (this.pendingUpdate) clearTimeout(this.pendingUpdate);
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;
        const state = this.view.state;
        if (state.doc.length === 0) return;

        const newMap = new Map<number, StatementBoundary>();
        const statements = getAllStatements(state);
        statements.forEach((stmt) => {
          const lineNum = state.doc.lineAt(stmt.from).number;
          newMap.set(lineNum, stmt);
        });

        this.view.dispatch({ effects: updateStatementsEffect.of(newMap) });
      }, 100);
    }

    destroy() {
      if (this.pendingUpdate) clearTimeout(this.pendingUpdate);
    }
  }
);
```

**Step 2: Update createRunGutterExtension to include the updater**

In the extension array (line 172-237), add `statementsUpdater` after `statementsField`:

```typescript
return [
  lintGutter({ ... }),
  statementsField,
  statementsUpdater, // NEW: focus-gated updater
  createRunGutterPlugin(onExecute),
  EditorView.theme({ ... }),
];
```

**Step 3: Verify — open 3 split panels, type in one**

Run: `make dev`
- Open 3 split panels with SQL editors
- Type rapidly in one panel
- Open DevTools Performance tab, record 5 seconds
- Expected: `getAllStatements` should only appear in the focused editor's flame chart
- Before: `getAllStatements` fires 3x per keystroke (once per editor)
- After: `getAllStatements` fires 1x per keystroke (only focused editor)

**Step 4: Commit**

```bash
git add src/components/CodeEditor/extensions/run-gutter.ts
git commit -m "perf: focus-gate run-gutter StateField to skip unfocused editors"
```

---

### Task 0.2: Isolate focusedPanelId from Panel Rendering

**Problem:** Every `focusPanel()` call does `set({ focusedPanelId: panelId })` which creates a new store snapshot. Every component that subscribes to `useWorkbenchStore((s) => s.focusedPanelId)` re-renders — including `PanelContentRenderer` which subscribes at line 70.

**Files:**
- Modify: `src/components/Workbench/PanelContentRenderer.tsx:70-71, 95`
- Test: React DevTools Profiler — focus-switch between panels should show 0 re-renders in non-focused panels

**Step 1: Replace direct focusedPanelId subscription with a derived boolean**

In `PanelContentRenderer.tsx`, change line 70-71 from:

```typescript
const focusedPanelId = useWorkbenchStore((state) => state.focusedPanelId);
```

to a memoized boolean selector:

```typescript
const isPanelFocused = useWorkbenchStore(
  useCallback((state: { focusedPanelId: string | null }) => state.focusedPanelId === panelId, [panelId])
);
```

And update line 95 from:

```typescript
const isPanelFocused = focusedPanelId === panelId;
```

to just use `isPanelFocused` directly (already computed above).

**Step 2: Verify — Focus switching should not re-render other panels**

Run: `make dev`
- Open React DevTools Profiler
- Open 2 split panels
- Click between panels to switch focus
- Expected: Only the newly focused and previously focused panels re-render (boolean changed), NOT all panels
- Check that PanelContentRenderer for panel C doesn't re-render when switching focus between A and B

**Step 3: Commit**

```bash
git add src/components/Workbench/PanelContentRenderer.tsx
git commit -m "perf: use boolean selector for focusedPanelId to prevent cross-panel re-renders"
```

---

### Task 0.3: Stabilize metadata Prop in PanelContentRenderer

**Problem:** `PanelContentRenderer` is wrapped in `React.memo` (line 64) but receives an unstable `metadata` object prop. Every time the parent re-renders, a new `metadata` reference is created even if contents are identical, defeating `React.memo`.

**Files:**
- Modify: The parent component that renders `PanelContentRenderer` (find via grep for `<PanelContentRenderer`)
- Test: React DevTools — tab metadata changes in panel A should NOT re-render panel B's content

**Step 1: Find where PanelContentRenderer receives metadata**

```bash
grep -rn "PanelContentRenderer" src/components/Workbench/
```

Identify the parent component and ensure it passes a stable reference for `metadata`. The fix is to use `useMemo` or extract the specific metadata for the active tab before passing it down, rather than passing the entire `panel.metadata` object.

**Step 2: Stabilize the metadata reference**

In the parent component, change from something like:

```typescript
<PanelContentRenderer
  panelId={panelId}
  tabId={activeTabId}
  metadata={panel.metadata?.[activeTabId]}
/>
```

to:

```typescript
// Serialize to detect actual changes (metadata is a flat object with primitive values)
const tabMetadata = panel.metadata?.[activeTabId];
const stableMetadata = useMemo(() => tabMetadata, [
  // Only re-create when the actual values change
  tabMetadata?.type,
  tabMetadata?.connectionId,
  tabMetadata?.database,
  tabMetadata?.schema,
  tabMetadata?.table,
  tabMetadata?.label,
]);

<PanelContentRenderer
  panelId={panelId}
  tabId={activeTabId}
  metadata={stableMetadata}
/>
```

**Step 3: Verify and commit**

```bash
git add src/components/Workbench/*.tsx
git commit -m "perf: stabilize metadata prop to preserve React.memo bailout"
```

---

### Task 0.4: Fix PanelDnd.tsx focusedPanelId and panelContents.size Subscriptions

**Problem:** `PanelDnd.tsx` (the Panel component) subscribes to `focusedPanelId` directly (line 209) AND `panelContents.size` (line 224). Both cause ALL panels to re-render on any focus change or any panel add/remove.

**Files:**
- Modify: `src/components/Workbench/PanelDnd.tsx:209, 224`
- Test: React DevTools Profiler — focus switch and tab close should not re-render uninvolved panels

**Step 1: Convert focusedPanelId to boolean selector**

In `PanelDnd.tsx`, change line 209 from:

```typescript
const focusedPanelId = useWorkbenchStore((state) => state.focusedPanelId);
```

to:

```typescript
const isPanelFocused = useWorkbenchStore(
  useCallback((state) => state.focusedPanelId === panelId, [panelId])
);
```

Update all usages of `focusedPanelId === panelId` to just `isPanelFocused`.

**Step 2: Convert panelContents.size to boolean selector**

Change line 224 from:

```typescript
const panelCount = useWorkbenchStore((state) => state.panelContents.size);
```

to a boolean that only checks what the component actually needs:

```typescript
const isOnlyPanel = useWorkbenchStore(
  useCallback((state) => state.panelContents.size <= 1, [])
);
```

This changes from a number (re-renders on any count change) to a boolean (re-renders only when crossing the 1-panel threshold).

**Step 3: Verify and commit**

```bash
git add src/components/Workbench/PanelDnd.tsx
git commit -m "perf: use boolean selectors in PanelDnd to prevent cross-panel re-renders"
```

---

### Task 0.5: Remove Redundant Focus Tracking in QueryPanel

**Problem:** `QueryPanel.tsx` has TWO focus tracking mechanisms:
1. Line 81-82: Boolean selector `useWorkbenchStore((state) => state.focusedPanelId === panelId)` (correct approach)
2. Lines 991-1001: Manual `useWorkbenchStore.subscribe()` + ref pattern (redundant)

The manual subscription creates an extra listener that fires on EVERY store change, not just focus changes.

**Files:**
- Modify: `src/components/QueryPanel/QueryPanel.tsx:991-1001`
- Test: Verify auto-focus still works after removing redundant subscription

**Step 1: Remove the manual subscribe pattern**

Delete lines 991-1001 (the `useEffect` with `useWorkbenchStore.subscribe()`):

```typescript
// DELETE THIS BLOCK
const isFocusedRef = useRef(false);
useEffect(() => {
  isFocusedRef.current = panelId === useWorkbenchStore.getState().focusedPanelId;
  const unsubscribe = useWorkbenchStore.subscribe((state) => {
    isFocusedRef.current = panelId === state.focusedPanelId;
  });
  return unsubscribe;
}, [panelId]);
```

Replace `isFocusedRef.current` usages with the existing `isPanelFocused` boolean (line 81-82). If ref-based (non-rendering) focus checks are needed in event handlers, use `usePanelFocusStore.getState().focusedPanelId === panelId` instead.

**Step 2: Verify and commit**

```bash
git add src/components/QueryPanel/QueryPanel.tsx
git commit -m "perf: remove redundant focus tracking subscription in QueryPanel"
```

---

## Phase 1: Store Isolation (Week 1)

Modeled on VS Code's separation of layout state from editor state.

---

### Task 1.1: Create Dedicated Panel Focus Store

**Problem:** `workbenchStore` bundles layout tree, panel contents, focus state, drag-drop context, and history into one store. Any mutation to any field causes ALL subscribers to re-evaluate. The `focusedPanelId` changes on every click but only 1-2 components actually need it.

**Files:**
- Create: `src/stores/panelFocusStore.ts`
- Modify: `src/stores/workbenchStore.ts:27, 46, 354-371, 373-385`
- Modify: All consumers of `focusedPanelId` (grep for `focusedPanelId`)
- Test: `pnpm typecheck`

**Step 1: Create panelFocusStore**

```typescript
// src/stores/panelFocusStore.ts
import { create } from "zustand";

interface PanelFocusStore {
  focusedPanelId: string | null;
  focusPanel: (panelId: string) => void;
  clearFocus: () => void;
}

export const usePanelFocusStore = create<PanelFocusStore>()((set, get) => ({
  focusedPanelId: null,

  focusPanel: (panelId) => {
    if (get().focusedPanelId === panelId) return;
    set({ focusedPanelId: panelId });
  },

  clearFocus: () => {
    set({ focusedPanelId: null });
  },
}));
```

**Step 2: Remove focusedPanelId from workbenchStore**

In `src/stores/workbenchStore.ts`:
- Remove `focusedPanelId` from the interface (line 27)
- Remove from initial state (line 83)
- Update `focusPanel` action (lines 354-371) to delegate to `panelFocusStore`
- Update `focusAdjacentPanel` (lines 373-385) similarly
- Update all `set()` calls that include `focusedPanelId` to also call `usePanelFocusStore.getState().focusPanel()`

**Step 3: Update all consumers**

```bash
grep -rn "focusedPanelId" src/ --include="*.ts" --include="*.tsx"
```

Change each `useWorkbenchStore((s) => s.focusedPanelId)` to `usePanelFocusStore((s) => s.focusedPanelId)`.

**Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: No type errors, no lint errors

**Step 5: Commit**

```bash
git add src/stores/panelFocusStore.ts src/stores/workbenchStore.ts src/components/
git commit -m "refactor: extract focusedPanelId into dedicated panelFocusStore"
```

---

### Task 1.2: Granular Panel Content Selectors

**Problem:** Actions like `addTab`, `removeTab`, `setActiveTab`, `updateTabMetadata` all do `new Map(panelContents)` (creating a new Map reference) even though only ONE panel changed. This triggers re-renders for all panels.

**Files:**
- Modify: `src/stores/workbenchStore.ts` — `addTab` (484-522), `removeTab` (524-558), `setActiveTab` (630-668), `updateTabMetadata` (670-698)
- Create: `src/hooks/usePanelContent.ts` — granular hook that only re-renders when THIS panel's content changes
- Test: `pnpm typecheck`

**Step 1: Create usePanelContent hook with shallow equality**

```typescript
// src/hooks/usePanelContent.ts
import { useRef, useCallback } from "react";
import useWorkbenchStore from "@/stores/workbenchStore";
import type { PanelContent } from "@/types/workbench";

/**
 * Subscribe to a single panel's content without re-rendering when other panels change.
 * Uses reference equality on the PanelContent object itself.
 */
export function usePanelContent(panelId: string): PanelContent | undefined {
  const prevRef = useRef<PanelContent | undefined>(undefined);

  return useWorkbenchStore(
    useCallback(
      (state) => {
        const next = state.panelContents.get(panelId);
        // Return previous reference if content hasn't changed
        // This works because updateSinglePanel preserves references for unchanged panels
        if (next === prevRef.current) return prevRef.current;
        prevRef.current = next;
        return next;
      },
      [panelId]
    )
  );
}
```

**Step 2: Update Panel component to use the new hook**

Find the component that renders panel tabs (the parent of `PanelContentRenderer`) and replace its `useWorkbenchStore` subscription with `usePanelContent(panelId)`.

**Step 3: Verify and commit**

```bash
git add src/hooks/usePanelContent.ts src/components/Workbench/
git commit -m "perf: add granular usePanelContent hook to prevent cross-panel re-renders"
```

---

### Task 1.3: Separate Layout Tree Store from Panel Content

**Problem:** `resizePanelAction` (line 295-301) creates a new `layoutTree` reference on every resize drag, which triggers all subscribers — even those that only care about panel content.

**Files:**
- Modify: `src/stores/workbenchStore.ts`
- Test: React DevTools Profiler during resize

**Step 1: Add a `layoutVersion` counter instead of relying on tree reference**

Components that need to know about layout changes (like `GridRenderer`) can subscribe to `layoutTree` directly. Components that only need panel content should NOT subscribe to `layoutTree`.

Audit all `useWorkbenchStore` calls to ensure components select ONLY the fields they need:

```bash
grep -rn "useWorkbenchStore(" src/components/ --include="*.tsx" | head -30
```

For each file, verify the selector is granular. Fix any that select the entire store or select `layoutTree` when they only need panel data.

**Step 2: Verify**

- Open 2 split panels
- Drag the resize handle
- React DevTools Profiler should show ONLY `GridRenderer` re-rendering, not `PanelContentRenderer`

**Step 3: Commit**

```bash
git add src/stores/workbenchStore.ts src/components/
git commit -m "perf: audit store selectors to prevent layout-resize re-rendering content"
```

---

## Phase 2: Editor Extension Phasing (Weeks 2-3)

Modeled on VS Code's **contribution phasing** — 5 phases: Eager / AfterFirstRender / BeforeFirstInteraction / Eventually / Lazy.

VS Code reference (`src/vs/editor/common/editorCommon.ts`):
- **Eager**: Created immediately when ICodeEditor is instantiated. Only phase that can participate in view state save/restore.
- **AfterFirstRender**: Created at the latest 50ms after first render after attaching a text model.
- **BeforeFirstInteraction**: Created before editor emits user interaction events (mouse, keyboard).
- **Eventually**: Created when idle time available, at the latest 5000ms after editor creation. Use if contribution is mostly driven by actions/commands.
- **Lazy**: Created only when explicitly requested via `getContribution`. Use if contribution is only driven by actions/commands.

For our CodeMirror 6 extensions, we map these to 3 practical phases (Eager / AfterFirstRender / Eventually) since CM6 doesn't have a separate "interaction gating" mechanism.

---

### Task 2.1: Categorize Extensions by Phase

**Problem:** `SqlEditor.tsx` loads 20+ extensions eagerly on mount (lines 549-643). Extensions like refactoring, format-on-paste, query-history-nav, and semantic-highlighting are not needed until the user interacts with the editor.

**Files:**
- Document only (no code changes yet)

**Step 1: Categorize all extensions**

| Extension | Phase | Rationale |
|-----------|-------|-----------|
| `baseTheme` | Eager | Visual correctness |
| `tooltips` | Eager | Required for hover |
| `history()` | Eager | Undo must work from keystroke 1 |
| `bracketMatching()` | Eager | Visual feedback |
| `closeBrackets()` | Eager | Typing correctness |
| `highlightSelectionMatches` | Eager | Selection visual |
| `indentOnInput()` | Eager | Typing correctness |
| `lineNumbers()` | Eager | Visual correctness |
| `highlightActiveLine()` | Eager | Visual correctness |
| `foldGutter()` | Eager | Visual correctness |
| `search()` | Eager | Core feature |
| `keymaps` | Eager | Must work immediately |
| `compartments.*` | Eager | Dynamic reconfiguration |
| `updateListener` | Eager | onChange callback |
| `scrollPastEnd()` | AfterFirstRender | Nice-to-have |
| `codeFolding()` | AfterFirstRender | Not needed on first paint |
| `createMultiCursorExtension()` | AfterFirstRender | Advanced feature |
| `createSnippetExtension()` | Eventually | Power user feature |
| `createParameterHintsExtension()` | Eventually | Context-dependent |
| `createFormatterExtension()` | Eventually | Triggered by user action |
| `createGotoDefinitionExtension()` | Eventually | Triggered by Cmd+Click |
| `createRefactoringExtension()` | Eventually | F2/Cmd+. triggered |
| `createFormatOnPasteExtension()` | Eventually | Paste event only |
| `createQueryHistoryNavExtension()` | Eventually | Alt+Up/Down only |
| `createRunGutterExtension()` | AfterFirstRender | Visual, but not critical for first paint |

**Step 2: Commit documentation**

No code change needed — this categorization guides Tasks 2.2 and 2.3.

---

### Task 2.2: Implement Extension Phasing in SqlEditor

**Files:**
- Create: `src/components/CodeEditor/hooks/useExtensionPhasing.ts`
- Modify: `src/components/CodeEditor/SqlEditor.tsx:547-643`
- Test: Performance trace — measure time-to-interactive

**Step 1: Create the phasing hook**

```typescript
// src/components/CodeEditor/hooks/useExtensionPhasing.ts
import { useEffect, useRef } from "react";
import { type EditorView } from "@codemirror/view";
import { Compartment, type Extension } from "@codemirror/state";

/**
 * Phases extensions into an already-mounted editor.
 * Phase 1 (AfterFirstRender): Added after first rAF
 * Phase 2 (Eventually): Added after 2 seconds idle
 */
export function useExtensionPhasing(
  viewRef: React.RefObject<EditorView | null>,
  phase1Extensions: Extension[],
  phase2Extensions: Extension[],
) {
  const compartmentRef = useRef({
    phase1: new Compartment(),
    phase2: new Compartment(),
  });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Phase 1: After first render (next rAF)
    const rafId = requestAnimationFrame(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartmentRef.current.phase1.reconfigure(phase1Extensions),
      });
    });

    // Phase 2: Eventually (after 2s idle)
    const timeoutId = setTimeout(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartmentRef.current.phase2.reconfigure(phase2Extensions),
      });
    }, 2000);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, []); // Only on mount

  return compartmentRef.current;
}
```

**Step 2: Modify SqlEditor to use phased loading**

In `SqlEditor.tsx`, change the `EditorState.create` extensions array:
- Keep Eager extensions in the initial array
- Wrap AfterFirstRender and Eventually extensions in compartments
- Use `useExtensionPhasing` to load them after mount

The initial extensions (lines 549-643) become:

```typescript
extensions: [
  // === EAGER (must be in initial state) ===
  baseTheme,
  tooltips({ parent: tooltipParent, position: "fixed" }),
  history(),
  bracketMatching(),
  closeBrackets(),
  highlightSelectionMatches({ ... }),
  indentOnInput(),
  indentUnit.of("  "),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  search({ top: true }),
  Prec.high(keymap.of(historyKeymap)),
  keymap.of([ ...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap ]),
  executeKeymap,
  Prec.high(keymap.of([{ key: "Tab", run: ... }])),
  compartments.theme.of(...),
  compartments.dialect.of(...),
  compartments.completion.of(...),
  compartments.readOnly.of(...),
  compartments.placeholder.of(...),
  updateListener,

  // === PHASE 1 & 2 (empty compartments, filled after mount) ===
  phasingCompartments.phase1.of([]),
  phasingCompartments.phase2.of([]),

  // Run gutter stays eager (it's visual and already focus-gated after Task 0.1)
  ...(onExecute ? [createRunGutterExtension(...)] : []),
],
```

Phase 1 extensions (after first render):
```typescript
[
  scrollPastEnd(),
  codeFolding({ placeholderText: "..." }),
  sqlFoldService,
  foldGutter(),
  createMultiCursorExtension(),
]
```

Phase 2 extensions (after 2s):
```typescript
[
  createSnippetExtension(),
  createParameterHintsExtension(),
  createFormatterExtension(effectiveDialect),
  createGotoDefinitionExtension(),
  createRefactoringExtension({ ... }),
  createFormatOnPasteExtension(effectiveDialect),
  createQueryHistoryNavExtension({ ... }),
]
```

**Step 3: Measure**

Run: `make dev`
- Open DevTools Performance tab
- Split to create a new panel
- Measure time from split action to first paint
- Expected: ~30-40% faster initial paint (fewer synchronous extensions)

**Step 4: Commit**

```bash
git add src/components/CodeEditor/hooks/useExtensionPhasing.ts src/components/CodeEditor/SqlEditor.tsx
git commit -m "perf: phase editor extensions (Eager/AfterFirstRender/Eventually)"
```

---

### Task 2.3: Focus-Gate Semantic Highlighting and Statement Highlight

**Problem:** Even with `hasFocus` guards in ViewPlugin update methods, the initial `constructor` still runs full analysis on mount for ALL editors (focused or not). For unfocused editors, we should defer initial analysis too.

**Files:**
- Modify: `src/components/CodeEditor/extensions/semantic-highlighting.ts:393-395`
- Modify: `src/components/CodeEditor/extensions/statement-highlight.ts:183-194`
- Test: Performance trace with 3 panels

**Step 1: Defer initial analysis in semantic highlighting**

In `semantic-highlighting.ts`, change the constructor (line 393-395):

```typescript
constructor(view: EditorView) {
  // Defer initial analysis - don't block construction
  this.decorations = Decoration.none;
  if (view.hasFocus) {
    // Only analyze immediately if focused
    this.decorations = this.analyze(view);
  }
}
```

**Step 2: Defer initial analysis in statement highlight**

In `statement-highlight.ts`, change the constructor (lines 183-194):

```typescript
constructor(view: EditorView) {
  this.view = view;
  this.lastDocLength = view.state.doc.length;
  // Defer heavy work for unfocused editors
  if (view.hasFocus && view.state.doc.length > 0) {
    this.cachedStatements = getAllStatements(view.state);
    const cursorPos = view.state.selection.main.head;
    const activeIndex = findActiveStatement(this.cachedStatements, cursorPos);
    this.decorations = buildStatementDecorations(view, this.cachedStatements, activeIndex);
  } else {
    this.decorations = Decoration.none;
  }
}
```

Also add a focus listener to trigger initial analysis when the editor first receives focus:

```typescript
update(update: ViewUpdate) {
  // ... existing code ...

  // Trigger initial analysis when editor first receives focus
  if (update.focusChanged && update.view.hasFocus && this.cachedStatements.length === 0) {
    // Run immediately (no debounce) for the first focus
    this.cachedStatements = getAllStatements(update.state);
    const cursorPos = update.state.selection.main.head;
    const activeIndex = findActiveStatement(this.cachedStatements, cursorPos);
    this.decorations = buildStatementDecorations(this.view, this.cachedStatements, activeIndex);
    this.view.requestMeasure();
    return;
  }
  // ... rest of existing debounced update logic ...
}
```

**Step 3: Verify**

Run: `make dev`
- Open 3 split panels simultaneously
- Performance trace should show `getAllStatements` and `analyzeSemanticTokens` called only once (for the focused editor), not 3x

**Step 4: Commit**

```bash
git add src/components/CodeEditor/extensions/semantic-highlighting.ts src/components/CodeEditor/extensions/statement-highlight.ts
git commit -m "perf: defer initial analysis in semantic/statement extensions for unfocused editors"
```

---

## Phase 3: Shared Linter Coordinator (Weeks 3-4)

Modeled on VS Code's **centralized animation frame scheduler** (`src/vs/base/browser/dom.ts`). VS Code avoids direct `window.requestAnimationFrame` calls — all rendering is routed through a global scheduler with priority queues:
- `NEXT_QUEUE` → tasks scheduled for the upcoming frame
- `CURRENT_QUEUE` → tasks currently executing
- Priority: `measure` (10000) > `normal` (0) > `modify` (-10000)
- This prevents layout thrashing by ensuring measurements precede modifications.

Our LinterCoordinator applies the same principle: deduplicate and batch IPC calls into a single RAF window.

---

### Task 3.1: Create Linter Coordinator Service

**Problem:** Each `SqlEditor` instance runs its own `unified-linter.ts` with independent Tauri IPC calls. With 3 split panels showing the same file, that's 3 separate `sql_validate` IPC calls. VS Code solves this with a shared coordinator.

**Files:**
- Create: `src/components/CodeEditor/services/linter-coordinator.ts`
- Modify: `src/components/CodeEditor/languages/sql/unified-linter.ts`
- Test: DevTools Network tab — count IPC calls during typing

**Step 1: Create the coordinator**

```typescript
// src/components/CodeEditor/services/linter-coordinator.ts
import { invoke } from "@tauri-apps/api/core";

interface LintRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface LintResult {
  diagnostics: Array<{
    from: number;
    to: number;
    severity: string;
    message: string;
    source: string;
  }>;
}

type LintCallback = (result: LintResult) => void;

/**
 * Singleton coordinator that deduplicates and batches lint IPC calls.
 *
 * Key behaviors:
 * 1. Deduplicates: If two editors have identical SQL, only one IPC call is made
 * 2. Batches: Collects requests within a RAF window, sends together
 * 3. Cancels: New request for same editor cancels previous pending request
 */
class LinterCoordinator {
  private pendingRequests = new Map<string, {
    request: LintRequest;
    callbacks: LintCallback[];
  }>();
  private rafId: number | null = null;
  private cache = new Map<string, { result: LintResult; timestamp: number }>();
  private CACHE_TTL = 5000; // 5 second cache

  /**
   * Request a lint for the given SQL. Returns a cancel function.
   */
  requestLint(
    editorId: string,
    request: LintRequest,
    callback: LintCallback,
  ): () => void {
    const cacheKey = this.getCacheKey(request);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // Use microtask to keep async contract
      queueMicrotask(() => callback(cached.result));
      return () => {};
    }

    // Deduplicate: if another editor already requested the same SQL, add callback
    const existing = this.pendingRequests.get(cacheKey);
    if (existing) {
      existing.callbacks.push(callback);
    } else {
      this.pendingRequests.set(cacheKey, {
        request,
        callbacks: [callback],
      });
    }

    // Schedule flush
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }

    // Return cancel function
    return () => {
      const entry = this.pendingRequests.get(cacheKey);
      if (entry) {
        entry.callbacks = entry.callbacks.filter((cb) => cb !== callback);
        if (entry.callbacks.length === 0) {
          this.pendingRequests.delete(cacheKey);
        }
      }
    };
  }

  private async flush() {
    this.rafId = null;
    const requests = new Map(this.pendingRequests);
    this.pendingRequests.clear();

    // Process each unique request
    for (const [cacheKey, { request, callbacks }] of requests) {
      if (callbacks.length === 0) continue;

      try {
        const response = await invoke<{
          errors: Array<{ from: number; to: number; message: string; severity: string; source: string }>;
          warnings: Array<{ from: number; to: number; message: string; severity: string; source: string }>;
        }>("sql_validate", { request });

        const result: LintResult = {
          diagnostics: [
            ...response.errors.map((e) => ({ ...e })),
            ...response.warnings.map((w) => ({ ...w })),
          ],
        };

        // Cache result
        this.cache.set(cacheKey, { result, timestamp: Date.now() });

        // Notify all callbacks
        for (const cb of callbacks) {
          cb(result);
        }
      } catch (error) {
        console.error("[LinterCoordinator] IPC failed:", error);
      }
    }
  }

  private getCacheKey(request: LintRequest): string {
    return `${request.dialect}:${request.connectionId ?? ""}:${request.schema ?? ""}:${request.sql}`;
  }

  /** Clear cache (e.g., on schema change) */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
export const linterCoordinator = new LinterCoordinator();
```

**Step 2: Update unified-linter to use the coordinator**

In `unified-linter.ts`, replace the direct `invoke` call in `lintWithRust` (lines 61-94) with:

```typescript
import { linterCoordinator } from "../../services/linter-coordinator";

// Generate a unique ID per editor instance
let editorCounter = 0;

export function createUnifiedLinter(config: UnifiedLinterConfig): Extension {
  const editorId = `editor-${++editorCounter}`;
  let lastSql = "";
  let lastDiagnostics: Diagnostic[] = [];
  let cancelPending: (() => void) | null = null;

  return linter(
    (view: EditorView): Promise<Diagnostic[]> => {
      const sql = view.state.doc.toString();
      if (!sql.trim()) return Promise.resolve([]);
      if (sql === lastSql) return Promise.resolve(lastDiagnostics);
      if (!view.hasFocus) return Promise.resolve(lastDiagnostics);

      // Cancel any pending request for this editor
      cancelPending?.();

      return new Promise((resolve) => {
        cancelPending = linterCoordinator.requestLint(
          editorId,
          {
            sql,
            dialect: config.dialect,
            connectionId: config.connectionId,
            schema: config.schema,
          },
          (result) => {
            const mappedDiagnostics = result.diagnostics.map((d) => {
              const from = Math.max(0, Math.min(sql.length, d.from));
              const rawTo = Math.max(0, Math.min(sql.length, d.to));
              const to = rawTo > from ? rawTo : Math.min(sql.length, from + 1);

              const diagnostic: Diagnostic = {
                from, to,
                severity: mapSeverity(d.severity),
                message: d.message,
                source: `sql-${d.source}`,
              };

              const actions = buildSqlQuickFixes(diagnostic);
              return actions.length > 0 ? { ...diagnostic, actions } : diagnostic;
            });

            lastSql = sql;
            lastDiagnostics = mappedDiagnostics;
            resolve(mappedDiagnostics);
          },
        );
      });
    },
    {
      delay: config.delay ?? 1200,
      needsRefresh: () => false,
      hideOn: (tr) => {
        if (tr.selection) return true;
        if (tr.docChanged) return true;
        if (tr.isUserEvent("select.pointer")) return true;
        if (tr.isUserEvent("select")) return true;
        return null;
      },
    },
  );
}
```

**Step 3: Verify**

Run: `make dev`
- Open 3 split panels all showing the same SQL
- Type a query
- Check Tauri IPC logs — should see 1 `sql_validate` call (not 3)
- All 3 panels should show the same lint results

**Step 4: Commit**

```bash
git add src/components/CodeEditor/services/linter-coordinator.ts src/components/CodeEditor/languages/sql/unified-linter.ts
git commit -m "perf: add LinterCoordinator singleton to deduplicate IPC across split editors"
```

---

## Phase 4: Layout Caching & Bailout (Week 5)

Modeled on VS Code's **SplitView layout patterns** (`src/vs/base/browser/ui/splitview/splitview.ts`):
- **Proportional caching**: `proportions` array caches size ratios; `layout()` skips priority-based distribution when proportions exist
- **`_cachedVisibleSize`**: Hidden views store previous dimensions for instantaneous show/hide
- **State machine gating**: `State.Idle/Busy` enum prevents modifications during layout
- **Tab dimension caching**: `multiEditorTabsControl.ts` returns quickly when "used dimensions are known"
- **`scheduleAtNextAnimationFrame()`**: Defers expensive DOM queries to prevent layout thrashing

---

### Task 4.1: Add Layout Bailout to PanelPortalContext

**Problem:** `PanelPortal` (PanelPortalContext.tsx:213-257) re-renders and updates position style on every resize, even when dimensions haven't actually changed. The `updateRect` function (line 52-83) has a bailout check, but `PanelPortal` re-renders via `setRect` on every notification.

**Files:**
- Modify: `src/components/Workbench/PanelPortalContext.tsx:213-257`
- Test: Performance trace during resize

**Step 1: Use ref-based positioning instead of state**

Replace `useState<PanelRect>` with a ref + direct DOM mutation to avoid React re-renders during resize:

```typescript
export function PanelPortal({ panelId, children }: { panelId: string; children: React.ReactNode }) {
  const { getPanelRect, subscribeToRect, getRootContainer } = usePanelPortal();
  const portalRef = useRef<HTMLDivElement>(null);
  const [initialRect] = useState(() => getPanelRect(panelId));

  useLayoutEffect(() => {
    const el = portalRef.current;
    if (!el) return;

    // Apply initial rect
    const rect = getPanelRect(panelId);
    if (rect) {
      el.style.top = `${rect.top}px`;
      el.style.left = `${rect.left}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.visibility = "visible";
    }

    // Subscribe to updates — mutate DOM directly, skip React
    return subscribeToRect(panelId, () => {
      const newRect = getPanelRect(panelId);
      if (!newRect || !el) return;
      el.style.top = `${newRect.top}px`;
      el.style.left = `${newRect.left}px`;
      el.style.width = `${newRect.width}px`;
      el.style.height = `${newRect.height}px`;
      el.style.visibility = "visible";
    });
  }, [panelId, getPanelRect, subscribeToRect]);

  const rootContainer = getRootContainer();
  if (!rootContainer) return null;

  return createPortal(
    <div
      ref={portalRef}
      style={{
        position: "absolute",
        top: initialRect?.top ?? 0,
        left: initialRect?.left ?? 0,
        width: initialRect?.width ?? 0,
        height: initialRect?.height ?? 0,
        visibility: initialRect ? "visible" : "hidden",
        overflow: "hidden",
      }}
      data-panel-portal={panelId}
    >
      {children}
    </div>,
    rootContainer,
  );
}
```

**Step 2: Verify**

Run: `make dev`
- Open 2 split panels
- Drag resize handle
- React DevTools Profiler should show ZERO re-renders in `PanelPortal` during resize
- Panels should still resize smoothly

**Step 3: Commit**

```bash
git add src/components/Workbench/PanelPortalContext.tsx
git commit -m "perf: use ref-based positioning in PanelPortal to skip React re-renders during resize"
```

---

### Task 4.2: Add Dimension Bailout to GridRenderer

**Problem:** `GridRenderer` calls `resizePanelAction` on every `onLayout` callback during resize, which creates a new `layoutTree` reference. The `useLayoutEffect` (lines 43-69) then syncs back, creating a feedback loop guarded only by a 0.1 delta threshold.

**Files:**
- Modify: `src/components/Workbench/GridRenderer.tsx:28-41, 43-69`
- Test: Performance trace during resize

**Step 1: Debounce the store update**

Replace the immediate `resizePanelAction` call with a debounced version:

```typescript
const handlePanelResize = useCallback(
  (sizes: number[]) => {
    if (node.type === "branch" && sizes.length === 2 && !isSyncingRef.current) {
      const newRatio = sizes[0]! / 100;
      // Only update store when resize settles (drag end)
      // During drag, the DOM handles the visual resize
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        resizePanelAction(path, newRatio);
      });
    }
  },
  [node.type, path, resizePanelAction],
);
```

**Step 2: Verify and commit**

```bash
git add src/components/Workbench/GridRenderer.tsx
git commit -m "perf: RAF-debounce resize store updates to reduce re-renders during drag"
```

---

## Phase 5: Deferred Config for Non-Visible Editors (Weeks 6-7)

Modeled on VS Code's **deferred config and batch processing patterns** (`src/vs/base/common/async.ts`):
- **`RunOnceScheduler`**: Wraps callback with configurable delay. Rapid `schedule()` calls cancel prior timeout and consolidate into single execution.
- **`RunOnceWorker`**: Collects units of work into array during delay period, passes all accumulated units to handler in one batch.
- **`ThrottledDelayer`**: Combines delay with throttling for config change propagation.
- **Tab label batching**: `updateEditorLabelScheduler` in `multiEditorTabsControl.ts` — "when this method may be called a lot of times from individual editors, we collect all those requests and then run the update once".

---

### Task 5.1: Skip Compartment Reconfiguration for Unfocused Editors

**Problem:** `useSqlEditorCompartments.ts` has 5 `useEffect` hooks that dispatch compartment reconfigurations whenever props change — for ALL editors, not just the focused one. When switching themes, all 3 editors dispatch 5 reconfiguration transactions simultaneously.

**Files:**
- Modify: `src/components/CodeEditor/hooks/useSqlEditorCompartments.ts:46-96`
- Test: Theme switch with 3 panels open

**Step 1: Add focus-aware batching**

Queue reconfiguration for unfocused editors and apply when they gain focus:

```typescript
export function useSqlEditorCompartments({
  viewRef,
  compartments,
  resolvedTheme,
  effectiveDialect,
  dialectExtensions,
  completionExtension,
  readOnly,
  placeholder,
  connectionId,
  schema,
}: UseSqlEditorCompartmentsOptions) {
  // Track pending reconfigurations for unfocused editors
  const pendingRef = useRef<Array<() => void>>([]);

  // Flush pending reconfigurations when editor gains focus
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const handleFocus = () => {
      const pending = pendingRef.current;
      if (pending.length > 0) {
        // Apply all pending reconfigurations in a single transaction batch
        for (const apply of pending) {
          apply();
        }
        pendingRef.current = [];
      }
    };

    view.dom.addEventListener("focusin", handleFocus);
    return () => view.dom.removeEventListener("focusin", handleFocus);
  }, [viewRef]);

  // Helper: dispatch immediately if focused, defer if not
  const dispatchOrDefer = useCallback(
    (fn: () => void) => {
      if (viewRef.current?.hasFocus) {
        fn();
      } else {
        pendingRef.current.push(fn);
      }
    },
    [viewRef],
  );

  // Update theme
  useEffect(() => {
    const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
    dispatchOrDefer(() => {
      viewRef.current?.dispatch({
        effects: compartments.theme.reconfigure(getThemeExtensions(actualTheme)),
      });
    });
  }, [resolvedTheme, compartments, viewRef, dispatchOrDefer]);

  // Update dialect extensions
  useEffect(() => {
    dispatchOrDefer(() => {
      viewRef.current?.dispatch({
        effects: compartments.dialect.reconfigure([
          ...createDialectLinter(effectiveDialect, { connectionId, schema }),
          ...dialectExtensions,
        ]),
      });
    });
  }, [effectiveDialect, dialectExtensions, compartments, connectionId, schema, viewRef, dispatchOrDefer]);

  // ... same pattern for completion, readOnly, placeholder ...
}
```

**Step 2: Verify**

Run: `make dev`
- Open 3 split panels
- Toggle theme (dark -> light)
- Performance trace should show compartment dispatches only for the focused editor
- When clicking into an unfocused editor, it should immediately apply deferred changes

**Step 3: Commit**

```bash
git add src/components/CodeEditor/hooks/useSqlEditorCompartments.ts
git commit -m "perf: defer compartment reconfiguration for unfocused editors"
```

---

## Phase 6: Global Statements Cache (Week 8)

---

### Task 6.1: Per-Editor Statements Cache Instead of Global Singleton

**Problem:** `query-utils.ts` uses a single global `statementsCache` (line 11-16). With multiple editors, each editor's `getAllStatements` call overwrites the cache, causing cache thrashing. Editor A types -> cache set -> Editor B types -> cache overwritten -> Editor A reads -> cache miss -> recompute.

**Files:**
- Modify: `src/components/CodeEditor/core/query-utils.ts:11-16, 289-392`
- Test: Performance trace with 3 editors having different SQL

**Step 1: Use a WeakMap keyed by EditorState for the cache**

Replace the global singleton cache with a per-state approach. Since `getAllStatements` takes `EditorState`, we can use the state's doc identity:

```typescript
// Replace global cache with LRU map keyed by docHash
const statementsLRU = new Map<string, {
  docLength: number;
  treeLength: number;
  statements: StatementBoundary[];
}>();
const MAX_CACHE_SIZE = 8; // Support up to 8 concurrent editors

function getCacheKey(state: EditorState): string {
  const docHash = hashDoc(state);
  return `${state.doc.length}:${docHash}:${syntaxTree(state).length}`;
}
```

Then in `getAllStatements`:

```typescript
export function getAllStatements(state: EditorState): StatementBoundary[] {
  const key = getCacheKey(state);
  const cached = statementsLRU.get(key);
  if (cached) return cached.statements;

  // ... compute statements ...

  // Evict oldest if at capacity
  if (statementsLRU.size >= MAX_CACHE_SIZE) {
    const firstKey = statementsLRU.keys().next().value;
    if (firstKey) statementsLRU.delete(firstKey);
  }
  statementsLRU.set(key, { docLength, treeLength, statements });

  return statements;
}
```

**Step 2: Verify**

Run: `make dev`
- Open 3 panels with different SQL
- Type in each panel
- Performance trace should show no redundant `getAllStatements` computations
- Each editor's cache hit rate should be independent

**Step 3: Commit**

```bash
git add src/components/CodeEditor/core/query-utils.ts
git commit -m "perf: replace global statementsCache with LRU map to prevent cross-editor cache thrashing"
```

---

## Phase 7: Lightbulb Plugin Optimization (Week 8)

---

### Task 7.1: Skip Lightbulb IPC When Cursor Hasn't Moved to a New Line

**Problem:** The refactoring lightbulb plugin (`sql-refactoring.ts` lines 225-289) calls `getRefactorActions()` IPC on every cursor move with a 150ms debounce. Most cursor moves within the same line don't need a new IPC call since the available refactorings are the same.

**Files:**
- Modify: `src/components/CodeEditor/extensions/sql-refactoring.ts:225-289`
- Test: Performance trace — cursor movement should show fewer IPC calls

**Step 1: Track last-analyzed line number**

```typescript
const lightbulbPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    lastAnalyzedLine: number = -1;
    lastDocVersion: number = -1;

    constructor(_view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.view.hasFocus) return;

      if (update.selectionSet || update.docChanged) {
        // Check if we've moved to a different line
        const pos = update.state.selection.main.from;
        const currentLine = update.state.doc.lineAt(pos).number;
        const docVersion = update.state.doc.length; // Proxy for version

        // Skip IPC if same line and doc hasn't changed
        if (currentLine === this.lastAnalyzedLine && docVersion === this.lastDocVersion) {
          return;
        }

        if (this.pendingUpdate) clearTimeout(this.pendingUpdate);

        this.pendingUpdate = setTimeout(async () => {
          if (update.view.dom.isConnected && update.view.hasFocus) {
            this.lastAnalyzedLine = currentLine;
            this.lastDocVersion = docVersion;
            await this.updateLightbulbs(update.view);
            this.pendingUpdate = null;
          }
        }, 150);
      }
    }

    // ... rest unchanged ...
  },
  { decorations: (v) => v.decorations },
);
```

**Step 2: Verify and commit**

```bash
git add src/components/CodeEditor/extensions/sql-refactoring.ts
git commit -m "perf: skip lightbulb IPC when cursor stays on same line"
```

---

## Phase 8: Post-Implementation Measurements (Week 9)

These measurement tasks were identified by codebase audit as areas that need verification after the main optimizations are in place.

---

### Task 8.1: Measure updateTabMetadata Impact

**Problem:** `updateTabMetadata` in `workbenchStore.ts` (lines 670-698) is called every 1000ms while typing (via `TAB_METADATA_SYNC_DEBOUNCE_MS` in QueryPanel). Each call creates a `new Map(panelContents)` and rebuilds `layoutTree` via `updateSinglePanel`. After Phase 1's store isolation, measure if this is still a bottleneck.

**Steps:**
1. After Phase 1 is complete, log `updateTabMetadata` call frequency during a 30-second typing session
2. Measure subscriber count for `panelContents` at runtime
3. If > 5 calls/second still cause re-renders:
   - Consider increasing debounce from 1000ms to 2000ms
   - Or move query text metadata to `tabStateStore` (already separate)

**Commit:** Only if changes needed.

---

### Task 8.2: Audit BaseDataGrid Re-renders on focused Prop

**Problem:** `PanelContentRenderer` passes `focused={isPanelFocused}` to DataGrid components (lines 270, 287, 464). Need to verify if changing `focused` causes full grid re-renders or if `React.memo` on `BaseDataGrid` prevents cascade.

**Steps:**
1. After Phase 0-1 is complete, add React DevTools Profiler markers to `BaseDataGrid`
2. Switch focus between a `query` panel and a `table` (data view) panel
3. Record whether `BaseDataGrid` re-renders when `focused` prop changes
4. If full grid re-renders detected, add `React.memo` with custom comparison:
   ```typescript
   memo(BaseDataGrid, (prev, next) =>
     prev.focused === next.focused &&
     prev.data === next.data &&
     prev.columns === next.columns
   );
   ```
5. Document findings for `DocumentDataGrid` and `KeyValueDataGrid` (same pattern)

**Commit:** Only if re-render issue confirmed.

---

### Task 8.3: Verify WorkbenchLayout Selector Granularity

**Problem:** `WorkbenchLayout.tsx` (lines 37-45) destructures the ENTIRE workbenchStore. After Phase 1 splits `focusedPanelId` out, verify that WorkbenchLayout ONLY subscribes to what it needs.

**Steps:**
1. After Phase 1, grep for all `useWorkbenchStore` calls in `WorkbenchLayout.tsx`
2. Ensure each call uses a granular selector, not `useWorkbenchStore()` with no args
3. Expected pattern:
   ```typescript
   const layoutTree = useWorkbenchStore((s) => s.layoutTree);
   const initializeLayout = useWorkbenchStore((s) => s.initializeLayout);
   // etc. — NEVER destructure the entire store
   ```
4. If any broad subscriptions remain, convert to granular selectors

**Commit:** Fix any remaining broad subscriptions.

---

## Summary: Expected Impact

| Phase | What Changes | Affects | Expected Impact |
|-------|-------------|---------|-----------------|
| Phase 0 | Focus-gate StateField, boolean selectors, metadata stabilization, PanelDnd fix, QueryPanel cleanup | ALL tabs | **50-70% fewer CPU cycles** with 2+ panels |
| Phase 1 | Store isolation, granular selectors | ALL tabs | **~0 cross-panel re-renders** on focus/tab changes |
| Phase 2 | Extension phasing (5-phase VS Code model → 3-phase CM6 adaptation) | query, mongo-query, erd | **30-40% faster** editor mount |
| Phase 3 | Shared linter coordinator (global RAF scheduler pattern) | query (SqlEditor) | **66% fewer IPC calls** with 3 query panels |
| Phase 4 | Layout caching, ref-based positioning | ALL tabs | **0 React re-renders** during resize |
| Phase 5 | Deferred config for unfocused editors (RunOnceWorker batch pattern) | query, mongo-query | **~80% fewer compartment dispatches** on config changes |
| Phase 6 | LRU statements cache | query (SqlEditor) | **Eliminates cache thrashing** across editors |
| Phase 7 | Line-aware lightbulb | query (SqlEditor) | **~60% fewer IPC calls** during navigation |
| Phase 8 | Post-implementation measurements | ALL tabs | Validates assumptions, catches remaining issues |

---

## How to Verify Overall Progress

After each phase, run these benchmarks:

### Benchmark 1: SQL Editor Multi-Panel (CM6-heavy)
1. Open 4 split panels (2x2 grid), all with `query` tabs
2. Type `SELECT * FROM users WHERE id = 1;` in the focused panel
3. Record a 10-second Performance trace
4. Check:
   - **Main thread busy time** (should decrease each phase)
   - **IPC call count** (should decrease in Phase 0, 3, 7)
   - **React commit count** (should decrease in Phase 0, 1, 4)
   - **Time to first paint** after split (should decrease in Phase 2)

Target: With 4 query panels, typing in the focused panel should feel identical to typing with 1 panel.

### Benchmark 2: Mixed Tab Types (real-world scenario)
1. Open 3 split panels: `query` | `table` (data view) | `table` (structure view)
2. Type a query in the SQL editor panel
3. Switch focus between all 3 panels by clicking
4. Check:
   - **React commit count** on focus switch (should be 2, not 3+)
   - **No re-mount** of DataGrid or TableStructure when switching focus
   - **No IPC calls** from unfocused panels

Target: Focus switching between mixed tab types should be instantaneous (<16ms).

### Benchmark 3: Resize with Heavy Tabs
1. Open 2 split panels: `query` | `erd`
2. Drag the resize handle back and forth for 5 seconds
3. Check:
   - **Zero React re-renders** in PanelPortal during drag (Phase 4)
   - **No layout thrash** in ERDPanel's ReactFlow canvas
   - **Smooth 60fps** resize animation

Target: Resize should be purely DOM-driven with zero React overhead.
