# Revert Query Execution to v0.9.0

## Goal

Revert query execution (Rust adapters + UI) and QueryPanel to v0.9.0 stable base while keeping post-v0.9.0 features:
- ExplainViewer
- PlanDiff
- QueryOutline
- Export features (CSV, JSON, INSERT, Markdown)

## Background

Since v0.9.0 (Dec 4, 2025), 89 commits introduced ~7000 lines of changes to QueryPanel and ~850 lines to PostgreSQL adapters. These changes caused:
- Performance regressions
- Bugs
- UI/UX issues
- Stability problems

## Design

### Phase 1: Git Revert Core Files

Revert these files to v0.9.0:

**Frontend (QueryPanel):**
- `src/components/QueryPanel/QueryPanel.tsx`
- `src/components/QueryPanel/ResultViewer.tsx`
- `src/components/QueryPanel/QueryToolbar.tsx`
- `src/components/QueryPanel/QueryEditor.tsx`
- `src/components/QueryPanel/QueryLimitControl.tsx`
- `src/components/QueryPanel/QueryHistory.tsx`
- `src/components/QueryPanel/SavedQueries.tsx`

**Backend (Rust):**
- `src-tauri/src/adapters/postgres/adapter.rs`
- `src-tauri/src/adapters/postgres/fast_converter.rs`
- `src-tauri/src/adapters/postgres/mod.rs`
- `src-tauri/src/adapters/postgres/query_fast.rs`
- `src-tauri/src/commands.rs`

**Services:**
- `src/services/queryStreamClient.ts`
- `src/services/tableStreamingService.ts`

**Delete (new files not in v0.9.0):**
- `src/components/QueryPanel/hooks/` (entire directory)
- `src/components/QueryPanel/BackgroundQueryIndicator.tsx`
- `src-tauri/src/adapters/postgres/msgpack_converter.rs`

### Phase 2: Keep Standalone Features

These files are kept as-is (no revert):
- `src/components/QueryPanel/ExplainViewer.tsx`
- `src/components/QueryPanel/PlanDiff.tsx`
- `src/components/QueryPanel/QueryOutline.tsx`
- `src/utils/csvExport.ts`
- `src/utils/jsonExport.ts`
- `src/utils/markdownExport.ts`
- `src/utils/sqlInsertExport.ts`
- `src/utils/*Export.test.ts`

### Phase 3: Re-integrate Features

#### 3.1 Export Features

Extract `ExportMenu` component from current `ResultViewer.tsx` and add to v0.9.0 version:

```typescript
// Add imports
import { exportToCSV, type ExportOptions } from "@/utils/csvExport";
import { exportToJSON, type JsonExportOptions } from "@/utils/jsonExport";
import { copyInsertToClipboard } from "@/utils/sqlInsertExport";
import { copyMarkdownToClipboard } from "@/utils/markdownExport";

// Add ExportMenu component (~100 lines)
// Add ExportMenu button to toolbar
```

#### 3.2 ExplainViewer

Extend v0.9.0 ResultViewer:

```typescript
// Change viewMode type
viewMode: "table" | "json" | "explain" | "raw" | "stats"

// Add import
import { ExplainViewer } from "./ExplainViewer";

// Add conditional render
{viewMode === "explain" || viewMode === "raw" || viewMode === "stats" ? (
  <ExplainViewer result={result} viewMode={viewMode} ... />
) : ...}
```

Add to QueryToolbar:
```typescript
// Add handleExplainAnalyze function
// Add Explain button
```

#### 3.3 QueryOutline

Add to v0.9.0 QueryPanel:

```typescript
import { QueryOutline } from "./QueryOutline";

// Add to sidebar/panel
<QueryOutline sql={query} onNavigate={handleNavigate} />
```

## Commands

```bash
# Phase 1: Revert core files
git checkout v0.9.0 -- \
  src/components/QueryPanel/QueryPanel.tsx \
  src/components/QueryPanel/ResultViewer.tsx \
  src/components/QueryPanel/QueryToolbar.tsx \
  src/components/QueryPanel/QueryEditor.tsx \
  src/components/QueryPanel/QueryLimitControl.tsx \
  src/components/QueryPanel/QueryHistory.tsx \
  src/components/QueryPanel/SavedQueries.tsx \
  src-tauri/src/adapters/postgres/adapter.rs \
  src-tauri/src/adapters/postgres/fast_converter.rs \
  src-tauri/src/adapters/postgres/mod.rs \
  src-tauri/src/adapters/postgres/query_fast.rs \
  src-tauri/src/commands.rs \
  src/services/queryStreamClient.ts \
  src/services/tableStreamingService.ts

# Delete new files
rm -rf src/components/QueryPanel/hooks/
rm -f src/components/QueryPanel/BackgroundQueryIndicator.tsx
rm -f src-tauri/src/adapters/postgres/msgpack_converter.rs

# Phase 2-3: Manual integration (see above)
```

## Verification

After implementation:
1. Run `pnpm typecheck` - ensure no TypeScript errors
2. Run `pnpm test:unit` - ensure tests pass
3. Run `cargo test --lib` in src-tauri - ensure Rust tests pass
4. Run `pnpm tauri:dev` - manual testing:
   - Execute simple SELECT query
   - Execute multi-statement query
   - Test EXPLAIN functionality
   - Test export (CSV, JSON, INSERT, Markdown)
   - Test QueryOutline navigation
   - Verify no performance regression
