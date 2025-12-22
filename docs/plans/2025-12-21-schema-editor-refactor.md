# Schema Editor Refactor Plan

## Overview

This plan addresses critical issues in TableStructure, TableIndexes, and TableDesigner components that prevent DDL (Data Definition Language) operations from working correctly.

**Components:**
- `TableStructure` - Column editing for existing tables
- `TableIndexes` - Index management (currently read-only stub)
- `TableDesigner` - New table creation

---

## Root Cause Analysis

### Critical Bug: Payload Format Mismatch

The **primary reason editing doesn't work** is a payload format mismatch between frontend TypeScript types and backend Rust expectations.

**Frontend (commandFactory.ts):**
```typescript
// column.modify creates:
{
  columnName: "user_name",
  newDefinition: {
    dataType: "varchar(255)",
    nullable: true
  }
}

// column.add creates:
{
  column: {
    name: "new_col",
    dataType: "text",
    nullable: true
  },
  tempId: "abc123"
}
```

**Backend (executor.rs) expects:**
```rust
// column.modify expects:
{
  name: "user_name",      // MISMATCH: frontend sends "columnName"
  newType: "varchar(255)", // MISMATCH: frontend sends newDefinition.dataType
  nullable: true           // MISMATCH: frontend sends newDefinition.nullable
}

// column.add expects:
{
  name: "new_col",    // MISMATCH: frontend sends column.name
  dataType: "text",   // MISMATCH: frontend sends column.dataType
  nullable: true      // MISMATCH: frontend sends column.nullable
}
```

### Secondary Issues

1. **Wrong Grid Component**: TableStructure uses `DataGridBase` instead of `EditableDataGrid`
2. **Fragile Value Extraction**: Manual GridCell parsing instead of typed event handlers
3. **Missing Validation**: No column name or type validation before staging
4. **Dead Code**: TableIndexes has commandFactory but no UI wiring
5. **Orphaned Component**: TableDesigner generates SQL client-side with no backend integration

---

## Implementation Phases

### Phase 1: Fix Backend Payload Parsing (CRITICAL)

**Priority:** MUST DO FIRST - Blocks all DDL operations
**Effort:** 2-3 hours
**Risk:** Low

**Files to Modify:**
- `src-tauri/src/crud/executor.rs`

**Tasks:**

#### 1.1 Fix `execute_column_add`
```rust
// Current (broken):
let name = payload.get("name").and_then(|v| v.as_str());

// Fixed:
let column = payload.get("column").and_then(|v| v.as_object());
let name = column.and_then(|c| c.get("name")).and_then(|v| v.as_str());
let data_type = column.and_then(|c| c.get("dataType")).and_then(|v| v.as_str());
```

#### 1.2 Fix `execute_column_modify`
```rust
// Current (broken):
let name = payload.get("name").and_then(|v| v.as_str());
let new_type = payload.get("newType").and_then(|v| v.as_str());

// Fixed:
let column_name = payload.get("columnName").and_then(|v| v.as_str());
let new_def = payload.get("newDefinition").and_then(|v| v.as_object());
let new_type = new_def.and_then(|d| d.get("dataType")).and_then(|v| v.as_str());
let nullable = new_def.and_then(|d| d.get("nullable")).and_then(|v| v.as_bool());
```

#### 1.3 Fix `execute_column_drop`
```rust
// Verify payload field name matches frontend
let column_name = payload.get("columnName").and_then(|v| v.as_str());
```

#### 1.4 Fix `execute_column_rename`
```rust
// Current uses "oldName"/"newName", frontend sends "columnName"/"newName"
let old_name = payload.get("columnName").and_then(|v| v.as_str());
let new_name = payload.get("newName").and_then(|v| v.as_str());
```

#### 1.5 Fix Index Operations
```rust
// execute_index_create - extract from definition object
let definition = payload.get("definition").and_then(|v| v.as_object());
let name = definition.and_then(|d| d.get("name")).and_then(|v| v.as_str());
let columns = definition.and_then(|d| d.get("columns")).and_then(|v| v.as_array());

// execute_index_drop - use "indexName" not "name"
let index_name = payload.get("indexName").and_then(|v| v.as_str());
```

**Testing:**
- Unit tests for each payload parsing function
- Integration test: Add column → Verify SQL generation → Execute

---

### Phase 2: TableStructure Refactor

**Priority:** High - Core functionality
**Effort:** 4-6 hours
**Risk:** Medium

**Files to Modify:**
- `src/components/TableStructure/index.tsx`
- `src/components/TableStructure/types.ts`
- `src/components/TableStructure/utils.ts`

**Tasks:**

#### 2.1 Replace DataGridBase with EditableDataGrid
```typescript
// Before:
<DataGridBase
  onCellEdited={handleCellEdited}
  ...
/>

// After:
<EditableDataGrid
  tableKey={tableKey}
  rows={gridRows}
  columns={sizedColumns}
  getCellContent={getCellContent}
  onCellEditCommit={handleCellEditCommit}
  customRenderers={customRenderers}
  ...
/>
```

#### 2.2 Implement Proper Edit Handler
```typescript
const handleCellEditCommit = useCallback((event: GridEditCommitEvent) => {
  const { column, row, newValue, previousValue } = event;

  // Type-safe value extraction
  const extractedValue = extractCellValue(newValue);

  if (row._isPending) {
    // Update pending column.add command
    updatePendingColumnAdd(row._tempId, column.field, extractedValue);
  } else {
    // Create column.modify or column.rename command
    if (column.field === 'column_name') {
      stageColumnRename(row.column_name, extractedValue);
    } else {
      stageColumnModify(row.column_name, column.field, extractedValue);
    }
  }
}, []);
```

#### 2.3 Add Validation Layer
```typescript
const validateColumnEdit = (field: string, value: unknown): ValidationResult => {
  if (field === 'column_name') {
    if (!value || String(value).trim() === '') {
      return { valid: false, error: 'Column name is required' };
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(value))) {
      return { valid: false, error: 'Invalid column name format' };
    }
    // Check uniqueness
    if (existingColumnNames.includes(String(value))) {
      return { valid: false, error: 'Column name already exists' };
    }
  }
  return { valid: true };
};
```

#### 2.4 Visual Indicators for Pending Operations
```typescript
// Add _isPendingDelete flag to StructureGridRow
interface StructureGridRow {
  // ... existing fields
  _isPendingDelete?: boolean;
}

// In getCellContent, apply delete styling
const rowTheme = row._isPendingDelete
  ? {
      bgCell: "rgba(239, 68, 68, 0.06)", // red for delete
      textDark: "#dc2626",
      textDecoration: "line-through",
    }
  : row._isPending
  ? { bgCell: "rgba(34, 197, 94, 0.06)" } // green for add
  : row._isModified
  ? { bgCell: "rgba(252, 163, 17, 0.04)" } // orange for modify
  : undefined;
```

**Testing:**
- Add column → Edit name → Commit → Verify new column exists
- Modify column type → Commit → Verify type changed
- Delete column → Confirm → Commit → Verify column removed

---

### Phase 3: TableIndexes Enhancement

**Priority:** Medium - Important but can defer
**Effort:** 4-6 hours
**Risk:** Medium

**Files to Modify:**
- `src/components/TableIndexes/index.tsx`
- `src/components/TableIndexes/types.ts`
- `src/components/TableIndexes/utils.ts`

**Files to Create:**
- `src/components/TableIndexes/IndexCreationDialog.tsx`

**Tasks:**

#### 3.1 Add TableActionsToolbar
```typescript
<TableActionsToolbar
  addButtonLabel="Add Index"
  onAdd={() => setIndexDialogOpen(true)}
  onReviewChanges={() => setGlobalChangesDialogOpen(true)}
  pendingChangesCount={pendingCommands.length}
/>
```

#### 3.2 Create IndexCreationDialog
```typescript
interface IndexCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnMeta[];
  onSubmit: (definition: IndexDefinitionInput) => void;
}

// Dialog contents:
// - Index name input
// - Column multi-select (with ordering)
// - Unique checkbox
// - Index type dropdown (btree, hash, gin, gist, brin)
// - Partial index WHERE clause (optional, CodeMirror)
// - Include columns (INCLUDE clause, optional)
```

#### 3.3 Wire crudStore Integration
```typescript
const { stagedCommands, stageCommand } = useCrudStore();

const handleCreateIndex = (definition: IndexDefinitionInput) => {
  const command = createIndexCreateCommand(target, definition);
  stageCommand(command);
  toast.success("Index creation staged");
};

const handleDropIndex = (indexName: string) => {
  const command = createIndexDropCommand(target, indexName);
  stageCommand(command);
  toast.success("Index deletion staged");
};
```

#### 3.4 Add Delete Functionality
```typescript
// In getCellContent, add actions column
if (column.field === "actions") {
  return {
    kind: GridCellKind.Custom,
    data: { kind: "action-cell", actions: ["delete"] },
    ...
  };
}

// Handle delete click
const handleCellClick = (cell: Item) => {
  if (column.field === "actions") {
    setDeleteTarget(row);
    setDeleteDialogOpen(true);
  }
};
```

**Testing:**
- Create index via dialog → Review in GlobalChangesDialog → Commit
- Drop existing index → Confirm → Commit → Verify removed
- Create unique index → Verify UNIQUE in SQL preview

---

### Phase 4: TableDesigner Completion

**Priority:** Lower - Nice to have
**Effort:** 6-8 hours
**Risk:** Higher

**Files to Modify:**
- `src/components/TableDesigner/index.tsx`
- `src/types/crud.ts`
- `src/stores/crudStore.ts`
- `src-tauri/src/crud/executor.rs`

**Tasks:**

#### 4.1 Add table.create Command Type
```typescript
// In crud.ts
export type CrudOperationType =
  | 'table.create'  // NEW
  | 'table.drop'    // NEW
  | 'data.update'
  // ... existing types

export interface TableCreatePayload extends CrudCommandPayload {
  readonly tableName: string;
  readonly schema?: string;
  readonly columns: ColumnDefinitionInput[];
  readonly primaryKey?: string[];
  readonly ifNotExists?: boolean;
}
```

#### 4.2 Backend table.create Execution
```rust
async fn execute_table_create(adapter: &dyn DbAdapter, command: &CrudCommand) -> Result<u64> {
    let payload = command.payload.as_object()?;
    let table_name = payload.get("tableName").and_then(|v| v.as_str())?;
    let schema = command.target.schema.as_deref().unwrap_or("public");
    let columns = payload.get("columns").and_then(|v| v.as_array())?;

    let mut column_defs = Vec::new();
    for col in columns {
        let col_obj = col.as_object()?;
        let name = col_obj.get("name").and_then(|v| v.as_str())?;
        let data_type = col_obj.get("dataType").and_then(|v| v.as_str())?;
        let nullable = col_obj.get("nullable").and_then(|v| v.as_bool()).unwrap_or(true);

        let mut def = format!("{} {}", quote_identifier(name), data_type);
        if !nullable { def.push_str(" NOT NULL"); }
        column_defs.push(def);
    }

    // Build CREATE TABLE SQL
    let sql = format!(
        "CREATE TABLE {}.{} (\n  {}\n)",
        quote_identifier(schema),
        quote_identifier(table_name),
        column_defs.join(",\n  ")
    );

    adapter.execute(&sql).await
}
```

#### 4.3 Integrate with crudStore Properly
```typescript
// Instead of temporary table key, use proper command staging
const handleSave = () => {
  const command = createTableCreateCommand(target, {
    tableName,
    columns: gridRows.map(toColumnDefinition),
    primaryKey: pkColumns,
  });

  stageCommand(command);
  setGlobalChangesDialogOpen(true); // Let user review and commit
};
```

#### 4.4 Backend SQL Generation for Preview
```typescript
// Call backend to generate dialect-accurate SQL
const previewSQL = await invoke('generate_create_table_sql', {
  connectionId,
  definition: { tableName, columns, schema }
});
```

**Testing:**
- Create table with multiple columns → Review SQL → Commit → Verify table exists
- Create table with primary key → Verify PK constraint in SQL
- Create table in different schema → Verify schema prefix

---

## Shared Infrastructure

### New Utilities to Create

#### `src/components/shared/useSchemaEditing.ts`
```typescript
export function useSchemaEditing(options: SchemaEditingOptions) {
  // Common patterns for DDL editing:
  // - crudStore integration
  // - validation
  // - toast notifications
  // - pending state tracking
}
```

#### `src/components/shared/SchemaValidation.ts`
```typescript
export const validateColumnName = (name: string): ValidationResult => { ... };
export const validateDataType = (type: string, dialect: DatabaseType): ValidationResult => { ... };
export const validateIndexName = (name: string): ValidationResult => { ... };
```

---

## Implementation Order

| Phase | Component | Priority | Effort | Dependencies |
|-------|-----------|----------|--------|--------------|
| 1 | Backend Payload Fix | CRITICAL | 2-3h | None |
| 2 | TableStructure | High | 4-6h | Phase 1 |
| 3 | TableIndexes | Medium | 4-6h | Phase 1 |
| 4 | TableDesigner | Lower | 6-8h | Phase 1, new types |

**Total Estimated Effort:** 16-23 hours

---

## Risk Mitigation

1. **Phase 1 (Low Risk)**
   - Straightforward JSON parsing changes
   - Add comprehensive tests before modifying
   - Can easily rollback if issues

2. **Phase 2 (Medium Risk)**
   - Grid component swap may have edge cases
   - Test thoroughly with all column types
   - Keep DataGridBase fallback initially

3. **Phase 3 (Medium Risk)**
   - Index creation UI complexity
   - Start with simple btree indexes
   - Add advanced options incrementally

4. **Phase 4 (Higher Risk)**
   - New command type affects entire pipeline
   - Test with multiple database dialects
   - Consider feature flag for gradual rollout

---

## Success Criteria

### Phase 1 Complete When:
- [ ] Add column → Commit → Column exists in database
- [ ] Modify column type → Commit → Type changed
- [ ] Drop column → Commit → Column removed
- [ ] Rename column → Commit → Name changed
- [ ] Create index → Commit → Index exists
- [ ] Drop index → Commit → Index removed

### Phase 2 Complete When:
- [ ] TableStructure uses EditableDataGrid
- [ ] All edit operations work end-to-end
- [ ] Validation prevents invalid column names
- [ ] Visual indicators for all pending states

### Phase 3 Complete When:
- [ ] Can create indexes via UI dialog
- [ ] Can delete indexes with confirmation
- [ ] GlobalChangesDialog shows index operations
- [ ] SQL preview accurate for indexes

### Phase 4 Complete When:
- [ ] Can create new tables via TableDesigner
- [ ] Primary key designation works
- [ ] SQL preview uses backend generation
- [ ] Created tables appear in schema browser
