# Database Operations - Command Reference

Quick reference for all newly enabled/implemented database modification commands.

---

## Index Operations

### Create Index

**Command:** `create_index`

```typescript
await invoke('create_index', {
  connId: string,
  schema: string,
  table: string,
  index: {
    name: string,
    columns: string[],
    unique: boolean,
    index_type: string,  // 'btree', 'hash', 'gin', 'gist', etc.
    condition?: string   // For partial indexes: 'WHERE active = true'
  }
})
```

### Drop Index

**Command:** `drop_index`

```typescript
await invoke("drop_index", {
  connId: string,
  schema: string,
  indexName: string,
});
```

### Rename Index

**Command:** `rename_index`

```typescript
await invoke("rename_index", {
  connId: string,
  schema: string,
  oldName: string,
  newName: string,
});
```

---

## Column Operations

### Add Column

**Command:** `alter_table_add_column`

```typescript
await invoke("alter_table_add_column", {
  connId: string,
  schema: string,
  table: string,
  column: {
    name: string,
    data_type: string, // 'integer', 'text', 'timestamp', etc.
    nullable: boolean,
    default_value: string, // SQL expression: 'NOW()', '0', "'default'"
    check_constraint: string, // 'value > 0'
    comment: string,
  },
});
```

### Drop Column

**Command:** `alter_table_drop_column`

```typescript
await invoke("alter_table_drop_column", {
  connId: string,
  schema: string,
  table: string,
  columnName: string,
});
```

### Modify Column

**Command:** `alter_table_modify_column`

```typescript
await invoke("alter_table_modify_column", {
  connId: string,
  schema: string,
  table: string,
  column: {
    name: string,
    new_name: string,
    new_type: string,
    nullable: boolean,
    default_value: string,
    drop_default: boolean,
    comment: string,
  },
});
```

### Rename Column

**Command:** `alter_table_rename_column`

```typescript
await invoke("alter_table_rename_column", {
  connId: string,
  schema: string,
  table: string,
  oldName: string,
  newName: string,
});
```

---

## Foreign Key Operations

### Add Foreign Key

**Command:** `alter_table_add_foreign_key`

```typescript
await invoke("alter_table_add_foreign_key", {
  connId: string,
  schema: string,
  table: string,
  fk: {
    constraint_name: string,
    column_name: string,
    referenced_table: string,
    referenced_column: string,
    on_update: string, // 'NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT'
    on_delete: string, // 'NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT'
  },
});
```

### Drop Foreign Key

**Command:** `alter_table_drop_foreign_key`

```typescript
await invoke("alter_table_drop_foreign_key", {
  connId: string,
  schema: string,
  table: string,
  constraintName: string,
});
```

---

## Trigger Operations (NEW)

### Create Trigger

**Command:** `create_trigger`

```typescript
await invoke('create_trigger', {
  connId: string,
  schema: string,
  table: string,
  trigger: {
    name: string,
    event: string[],        // ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
    timing: string,         // 'BEFORE', 'AFTER', 'INSTEAD OF'
    level: string,          // 'ROW', 'STATEMENT'
    function_name: string,  // Name of trigger function (without '()')
    condition?: string,     // WHEN clause: 'NEW.status != OLD.status'
    for_each?: string       // Optional override of level
  }
})
```

**Example:**

```typescript
await invoke("create_trigger", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  trigger: {
    name: "audit_user_changes",
    event: ["INSERT", "UPDATE", "DELETE"],
    timing: "AFTER",
    level: "ROW",
    function_name: "log_user_audit",
    condition: "NEW.email != OLD.email",
  },
});
```

### Drop Trigger

**Command:** `drop_trigger`

```typescript
await invoke("drop_trigger", {
  connId: string,
  schema: string,
  table: string,
  triggerName: string,
});
```

### Enable/Disable Trigger

**Command:** `enable_disable_trigger`

```typescript
await invoke("enable_disable_trigger", {
  connId: string,
  schema: string,
  table: string,
  triggerName: string,
  enabled: boolean,
});
```

---

## Security Features

All commands use proper identifier quoting to prevent SQL injection:

### ✅ Safe (Quoted)

- Schema names
- Table names
- Column names
- Index names
- Constraint names
- Trigger names

### ⚠️ Not Quoted (Keywords)

- Data types (`integer`, `text`)
- Index types (`btree`, `hash`)
- FK actions (`CASCADE`, `SET NULL`)
- Trigger timing (`BEFORE`, `AFTER`)
- Trigger events (`INSERT`, `UPDATE`)

These are SQL keywords, not user identifiers, so they don't need quoting.

---

## Error Handling

All commands return `Result<(), String>`:

```typescript
try {
  await invoke('create_index', {...})
  console.log('Success!')
} catch (error) {
  console.error('Operation failed:', error)
  // error is a string with the database error message
}
```

Common errors:

- `"Connection not found"` - Invalid connection ID
- `"Not connected"` - Connection was closed
- `"duplicate key value"` - Unique constraint violation
- `"column already exists"` - Column name conflict
- `"relation does not exist"` - Invalid table/schema name

---

## Usage Examples

### Complete Index Workflow

```typescript
import { invoke } from "@tauri-apps/api/core";

// Create a unique partial index
await invoke("create_index", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  index: {
    name: "idx_active_users_email",
    columns: ["email"],
    unique: true,
    index_type: "btree",
    condition: "WHERE active = true",
  },
});

// Rename it
await invoke("rename_index", {
  connId: "conn-123",
  schema: "public",
  oldName: "idx_active_users_email",
  newName: "idx_users_email_active",
});

// Drop it
await invoke("drop_index", {
  connId: "conn-123",
  schema: "public",
  indexName: "idx_users_email_active",
});
```

### Complete Column Workflow

```typescript
// Add column
await invoke("alter_table_add_column", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  column: {
    name: "verified_at",
    data_type: "timestamp",
    nullable: true,
    comment: "Email verification timestamp",
  },
});

// Make it non-nullable with default
await invoke("alter_table_modify_column", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  column: {
    name: "verified_at",
    nullable: false,
    default_value: "NOW()",
  },
});

// Rename it
await invoke("alter_table_rename_column", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  oldName: "verified_at",
  newName: "email_verified_at",
});

// Drop it
await invoke("alter_table_drop_column", {
  connId: "conn-123",
  schema: "public",
  table: "users",
  columnName: "email_verified_at",
});
```

### Complete Trigger Workflow

```typescript
// Create trigger
await invoke("create_trigger", {
  connId: "conn-123",
  schema: "public",
  table: "orders",
  trigger: {
    name: "update_order_timestamp",
    event: ["UPDATE"],
    timing: "BEFORE",
    level: "ROW",
    function_name: "update_modified_column",
  },
});

// Disable trigger
await invoke("enable_disable_trigger", {
  connId: "conn-123",
  schema: "public",
  table: "orders",
  triggerName: "update_order_timestamp",
  enabled: false,
});

// Enable trigger
await invoke("enable_disable_trigger", {
  connId: "conn-123",
  schema: "public",
  table: "orders",
  triggerName: "update_order_timestamp",
  enabled: true,
});

// Drop trigger
await invoke("drop_trigger", {
  connId: "conn-123",
  schema: "public",
  table: "orders",
  triggerName: "update_order_timestamp",
});
```

---

## Database Service Layer

For higher-level usage, use the `databaseService`:

```typescript
import { databaseService } from '@/services/databaseService'

// Triggers
await databaseService.createTrigger(connectionId, schema, table, {...})
await databaseService.dropTrigger(connectionId, schema, table, triggerName)
await databaseService.enableDisableTrigger(connectionId, schema, table, triggerName, enabled)

// Indexes
await databaseService.createIndex(connectionId, schema, table, {...})
await databaseService.dropIndex(connectionId, schema, indexName)
await databaseService.renameIndex(connectionId, schema, oldName, newName)

// Columns (add these methods if not already present)
await databaseService.addColumn(connectionId, schema, table, {...})
await databaseService.dropColumn(connectionId, schema, table, columnName)
await databaseService.modifyColumn(connectionId, schema, table, {...})
await databaseService.renameColumn(connectionId, schema, table, oldName, newName)

// Foreign Keys
await databaseService.addForeignKey(connectionId, schema, table, {...})
await databaseService.dropForeignKey(connectionId, schema, table, constraintName)
```

---

## Notes

1. **Transaction Safety:** Operations are NOT wrapped in transactions by default. Consider implementing batch operations with transaction support for multi-step changes.

2. **Connection IDs:** Always use the backend connection ID from `databaseService.getBackendConnectionId(frontendId)`.

3. **Schema Defaults:** If schema is empty/null, defaults to `'public'` in most operations.

4. **Async Operations:** All commands are async and should be awaited.

5. **Error Messages:** Error messages come directly from PostgreSQL and can be technical. Consider wrapping in user-friendly messages in the UI layer.
