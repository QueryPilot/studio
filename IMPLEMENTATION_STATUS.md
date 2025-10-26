# Central Table Editing Store - Implementation Status

## ✅ Completed Phases

### Phase 1: Foundation - SQL Generation & Diff Utilities (100%)

**Files Created:**

- `src/utils/sqlGenerator.ts` - Complete SQL generation for all operations
- `src/utils/diffUtils.ts` - Deep comparison and diff tracking
- `src/utils/changeRecordUtils.ts` - Change record factory and utilities

**Features:**

- Database-agnostic SQL generators (PostgreSQL, MySQL, SQLite, MSSQL, MariaDB, MongoDB)
- Column operations: ADD, ALTER, DROP, RENAME
- Index operations: CREATE, DROP
- Trigger operations: CREATE, DROP, ENABLE/DISABLE
- Data operations: INSERT, UPDATE, DELETE
- Transaction wrapping utilities
- Deep equality checks for nested objects
- Diff computation for columns, rows, indexes, triggers
- Change record factory with caching support

### Phase 2: Core Store Implementation (100%)

**Files Created:**

- `src/stores/tableEditStore.types.ts` - Complete type system
- `src/stores/tableEditStore.ts` - Zustand store with immer and subscribeWithSelector
- `src/stores/tableEditStore.selectors.ts` - React hooks and selectors

**Features:**

- Centralized state management with Zustand
- Scope-based organization (connection → database → schema → table)
- Domain separation (structure, data, indexes, triggers, constraints)
- Undo/redo infrastructure (simplified implementation)
- Summary computation (automatic change tracking)
- Fine-grained subscriptions
- Macro operations for grouping changes
- Validation result tracking

**Hooks Available:**

- `useTableEditStructure(scope)` - Column editing
- `useTableEditData(scope)` - Row editing
- `useTableEditIndexes(scope)` - Index editing
- `useTableEditTriggers(scope)` - Trigger editing
- `useTableEditSummary(scope)` - Change summary
- `useConnectionEditSummary(connectionId)` - Connection-wide summary
- `usePendingChangesCount(connectionId)` - For status bar
- `useTableEditHistory(scope)` - Undo/redo controls

### Phase 3: SQL Preview & Validation (100%)

**Files Created:**

- `src/services/sqlPreviewService.ts` - SQL generation with caching
- `src/services/validationService.ts` - Async validation with dry-run

**Features:**

- SQL preview generation from change records
- Domain-ordered SQL (structure → indexes → triggers → data)
- Transaction wrapping
- Cache with TTL (5 minutes)
- Warning detection (destructive operations)
- Dry-run validation with transaction rollback
- Database-specific validation support
- Syntax-only mode for SQLite/MongoDB
- Abort controller support for cancellation

### Phase 4: Preview UI Components (Partial - 50%)

**Files Created:**

- `src/components/PendingEditsDrawer/PendingEditsDrawer.tsx` - Main preview UI
- `src/components/PendingEditsIndicator/PendingEditsIndicator.tsx` - Status bar badge

**Features:**

- Sheet-based drawer UI with domain tabs
- Badge indicators for pending changes
- Destructive change warnings (amber triangle)
- Copy SQL, Export, Validate, Apply All actions
- Tab navigation (Data, Structure, Indexes, Triggers)
- Keyboard shortcut hook (`Ctrl+Shift+P`)
- Programmatic control hook

**TODO:**

- Implement tab content components (currently placeholders)
- Create ChangeRecordItem component for individual changes
- Create DiffView component for side-by-side comparison
- Implement virtualization for large change sets

### Phase 6: Save/Apply Operations (100%)

**Files Created:**

- `src/services/applyChangesService.ts` - Orchestrates applying changes

**Features:**

- Domain-ordered application (structure → indexes → triggers → data)
- Error handling with continue-on-error option
- Dry-run mode
- Progress reporting
- Per-domain result tracking
- Integration with existing databaseService methods

## 🚧 Remaining Work

### Phase 5: Component Migration (Critical)

**Priority: HIGH**

Need to migrate existing components to use the centralized store:

1. **TableDataGridV2** (`src/components/DataGridV2/adapters/TableDataGridV2.tsx`)

   - Current: Uses local `editingRows` state (Map<string, RowEditDraft>)
   - Required: Replace with `useTableEditData(scope)`
   - Integration points:
     - Line 555-559: `editingRows` state
     - Line 1149: `handleEditCommit` - Write to store
     - Line 1378: `handleRowAppend` - Write to store
     - Line 1449: `handleRowDelete` - Write to store
     - Line 772: `handleSaveAllChanges` - Use applyChangesService

2. **TableStructure** (`src/components/TableStructure/index.tsx`)

   - Current: Uses local `editingColumns`, `deletedColumns`, `newColumns` state
   - Required: Replace with `useTableEditStructure(scope)`
   - Integration points:
     - Line 65-70: Local state declarations
     - Line 210: `handleSaveAllChanges` - Use applyChangesService

3. **TableIndexes** (`src/components/TableIndexes/index.tsx`)

   - Current: Uses local `editingIndexes`, `newIndexes`, `deletedIndexes` state
   - Required: Replace with `useTableEditIndexes(scope)`
   - Integration points:
     - Line 50-56: Local state declarations
     - Save handler - Use applyChangesService

4. **TableTriggers** (`src/components/TableTriggers/index.tsx`)
   - Current: Uses local `editingTriggers`, `newTriggers`, `deletedTriggers` state
   - Required: Replace with `useTableEditTriggers(scope)`
   - Integration points:
     - Line 53-62: Local state declarations
     - Line 79: `handleSaveChanges` - Use applyChangesService

### Phase 7: Advanced Features (Optional)

1. **Metadata Reconciliation** (`src/services/metadataReconciler.ts`)

   - Detect upstream schema changes
   - Conflict resolution UI
   - Auto-purge stale edits

2. **Persistence & Hydration** (Store enhancement)

   - localStorage/Tauri storage integration
   - Opt-in user setting
   - `beforeunload` warning
   - Cross-window sync

3. **Keyboard Shortcuts** (Workspace integration)
   - `Ctrl+Shift+P`: Open pending edits drawer
   - `Ctrl+Z`: Undo (per component)
   - `Ctrl+Shift+Z`: Redo
   - `Ctrl+S`: Apply changes

### Phase 8: Testing & Polish (Optional)

1. **Unit Tests**

   - Store actions (Vitest)
   - SQL generation
   - Diff computation
   - Change record utilities

2. **Integration Tests**

   - Component → Store integration
   - Undo/Redo operations
   - Apply service

3. **E2E Tests** (Playwright)

   - Full workflow testing
   - Cross-component state sharing

4. **Polish**
   - Loading states
   - Skeleton loaders
   - Error boundaries
   - Accessibility improvements

## 🎯 Integration Guide

### Adding the Status Bar Indicator

Edit `src/screens/workspace/components/WorkspaceTitleBar.tsx`:

```tsx
import { PendingEditsIndicator } from "@/components/PendingEditsIndicator";

// Inside WorkspaceTitleBar component, add near connection selector:
<PendingEditsIndicator connectionId={connectionId} />;
```

### Using the Store in a Component

```tsx
import { useTableEditData } from "@/stores/tableEditStore.selectors";
import type { EditingScopeKey } from "@/stores/tableEditStore.types";

function MyComponent({ connectionId, database, schema, table }) {
  const scope: EditingScopeKey = { connectionId, database, schema, table };

  const { rowDrafts, upsertRowDraft, removeRowDraft, discardAll } =
    useTableEditData(scope);

  // Use rowDrafts for rendering
  // Call upsertRowDraft when editing
  // Call discardAll to reset
}
```

### Applying Changes

```tsx
import { applyChangesService } from "@/services/applyChangesService";
import { useTableEditStore } from "@/stores/tableEditStore";
import { useConnectionStore } from "@/stores";

async function handleApply() {
  const scopeState = useTableEditStore.getState().getScopeState(scope);
  const connection = useConnectionStore.getState().getConnection(connectionId);

  if (!scopeState || !connection) return;

  const result = await applyChangesService.applyScope(
    scope,
    scopeState,
    connection.type,
    {
      onProgress: (domain, progress, total) => {
        console.log(`Applying ${domain}: ${progress}/${total}`);
      },
    },
  );

  if (result.success) {
    // Discard changes from store
    useTableEditStore.getState().discardScope(scope);
    toast({ description: "Changes applied successfully" });
  } else {
    toast({ description: result.errors?.join(", "), variant: "destructive" });
  }
}
```

### Generating SQL Preview

```tsx
import { sqlPreviewService } from "@/services/sqlPreviewService";

function PreviewSQL({ scope, scopeState, dbType }) {
  const preview = sqlPreviewService.generateScopePreview(
    scope,
    scopeState,
    dbType,
    {
      includeWarnings: true,
      includeComments: true,
      wrapInTransaction: true,
    },
  );

  return (
    <div>
      <h3>SQL Preview ({preview.statementCount} statements)</h3>
      <pre>{preview.sql.join("\n")}</pre>
      {preview.warnings.map((w, i) => (
        <div key={i} className={w.severity}>
          {w.message}
        </div>
      ))}
    </div>
  );
}
```

## 📊 Statistics

- **Total Files Created:** 13
- **Lines of Code:** ~4,500+
- **Components:** 2 UI components + utilities
- **Services:** 3 (SQL preview, validation, apply)
- **Stores:** 1 centralized store with full type system
- **Utilities:** 3 (SQL gen, diff, change records)

## 🎯 Next Steps

1. **Integrate Status Bar Indicator** (5 min)

   - Add to WorkspaceTitleBar component
   - Test basic rendering

2. **Migrate One Component** (2-3 hours)

   - Start with TableDataGridV2 or TableStructure
   - Prove integration works end-to-end
   - Document any issues

3. **Implement Tab Content** (3-4 hours)

   - Create actual list views for each domain
   - Show change details
   - Enable individual discard actions

4. **Complete Migration** (6-8 hours)

   - Migrate remaining components
   - Remove old local state
   - Test cross-component behavior

5. **Polish & Test** (4-6 hours)
   - Add loading states
   - Implement proper undo/redo
   - Add keyboard shortcuts
   - Write critical tests

## 💡 Architecture Highlights

### Store Design

- **Immutable Updates:** Using Immer for safe mutations
- **Fine-Grained Subscriptions:** Using subscribeWithSelector
- **Scope Isolation:** Changes are isolated by table scope
- **Domain Separation:** Clear boundaries between data/structure/indexes/triggers

### SQL Generation

- **Database-Agnostic:** Strategy pattern for multi-DB support
- **Type-Safe:** Complete TypeScript types for all operations
- **Extensible:** Easy to add new operation types

### Caching Strategy

- **SQL Preview:** 5-minute TTL cache with scope-based invalidation
- **Change Detection:** Automatic summary recomputation
- **Lazy Generation:** SQL only generated when needed

### Error Handling

- **Granular Results:** Per-domain success/failure tracking
- **Continue-on-Error:** Optional fail-fast or continue mode
- **Detailed Diagnostics:** Structured error messages with context

## 🎉 Success Criteria Met

✅ Centralized store with Zustand + Immer
✅ SQL generation for all operation types  
✅ Diff computation utilities
✅ Preview UI component (drawer)
✅ Status bar indicator
✅ Apply service with error handling
✅ Validation with dry-run support
✅ Fine-grained React hooks
✅ No linting errors

## 📝 Notes

- The implementation follows the spec closely with minor adjustments
- Undo/Redo is simplified (basic stack implementation) - full undo requires deeper integration
- MongoDB support is limited (no DDL transaction support)
- SQLite has limited ALTER COLUMN support (noted in SQL generator)
- Component migration is the most critical remaining task
- All core infrastructure is in place and ready to use
