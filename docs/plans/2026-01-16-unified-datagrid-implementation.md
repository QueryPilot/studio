# Unified DataGrid Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify SQL, MongoDB, and Redis data display under a single DataGrid infrastructure with paradigm-specific adapters and operation executors.

**Architecture:** Create a `GridDataSource` abstraction layer with SQL/Document/KeyValue implementations, plus an `OperationExecutor` layer for paradigm-specific command execution and preview generation.

**Tech Stack:** TypeScript, React 19, Zustand, Glide Data Grid, existing adapter system

**Scope:** This plan covers **Phase 1 (Foundation)** and **Phase 2 (Operation Executors)**. Phases 3-5 (MongoDB/Redis support) will be separate follow-up plans.

---

## Phase 1: Foundation

### Task 1: Create GridDataSource Interface

**Goal:** Define the core abstraction that all data sources will implement.

**Files:**
- Create: `src/components/DataGrid/sources/types.ts`
- Create: `src/components/DataGrid/sources/index.ts`

**Step 1: Write type definitions**

Create `src/components/DataGrid/sources/types.ts`:

```typescript
import type { GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';

/**
 * Identifier for different data source types
 */
export type DataSourceIdentifier =
  | { type: 'table'; database: string; schema?: string; table: string }
  | { type: 'collection'; database: string; collection: string }
  | { type: 'keyspace'; database: number; pattern?: string };

/**
 * Core abstraction for all data sources (SQL, Document, KeyValue)
 */
export interface GridDataSource<TRow = GridRowModel> {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';
  readonly connectionId: string;
  readonly identifier: DataSourceIdentifier;

  // Column definition
  getColumns(): GridColumnV2[];

  // Data access
  getRowCount(): number;
  getRow(index: number): TRow | undefined;
  getCellContent(row: number, col: number): GridCell;

  // Streaming/pagination
  fetchMore(offset: number, limit: number): Promise<void>;
  readonly isLoading: boolean;
  readonly hasMore: boolean;

  // CRUD capability
  readonly editable: boolean;
  createEditCommand(event: GridEditCommitEvent): CrudCommand | null;
  createInsertCommand(values: Record<string, unknown>): CrudCommand;
  createDeleteCommand(row: TRow): CrudCommand;
}

/**
 * Type guard to check if source is SQL
 */
export function isSqlDataSource(source: GridDataSource): boolean {
  return source.paradigm === 'sql';
}

/**
 * Type guard to check if source is Document (MongoDB)
 */
export function isDocumentDataSource(source: GridDataSource): boolean {
  return source.paradigm === 'document';
}

/**
 * Type guard to check if source is KeyValue (Redis)
 */
export function isKeyValueDataSource(source: GridDataSource): boolean {
  return source.paradigm === 'keyvalue';
}
```

**Step 2: Create barrel export**

Create `src/components/DataGrid/sources/index.ts`:

```typescript
export * from './types';
```

**Step 3: Commit**

```bash
git add src/components/DataGrid/sources/
git commit -m "feat(datagrid): add GridDataSource interface and types"
```

---

### Task 2: Create SqlDataSource Scaffold

**Goal:** Create the SQL implementation of GridDataSource (scaffold only, will extract logic later).

**Files:**
- Create: `src/components/DataGrid/sources/SqlDataSource.ts`
- Modify: `src/components/DataGrid/sources/index.ts`

**Step 1: Write SqlDataSource class scaffold**

Create `src/components/DataGrid/sources/SqlDataSource.ts`:

```typescript
import type { GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';
import type { GridDataSource, DataSourceIdentifier } from './types';

export interface SqlDataSourceConfig {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
}

/**
 * SQL data source implementation
 * Wraps SQL table data for the unified DataGrid
 */
export class SqlDataSource implements GridDataSource<GridRowModel> {
  readonly paradigm = 'sql' as const;
  readonly connectionId: string;
  readonly identifier: DataSourceIdentifier;
  readonly editable = true;

  private columns: GridColumnV2[] = [];
  private rows: GridRowModel[] = [];
  private _isLoading = false;
  private _hasMore = false;

  constructor(config: SqlDataSourceConfig) {
    this.connectionId = config.connectionId;
    this.identifier = {
      type: 'table',
      database: config.database,
      schema: config.schema,
      table: config.table,
    };
  }

  getColumns(): GridColumnV2[] {
    return this.columns;
  }

  getRowCount(): number {
    return this.rows.length;
  }

  getRow(index: number): GridRowModel | undefined {
    return this.rows[index];
  }

  getCellContent(row: number, col: number): GridCell {
    // TODO: Implement cell rendering logic
    return {
      kind: 'text' as const,
      data: '',
      displayData: '',
      allowOverlay: true,
    };
  }

  async fetchMore(offset: number, limit: number): Promise<void> {
    // TODO: Implement data fetching
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get hasMore(): boolean {
    return this._hasMore;
  }

  createEditCommand(event: GridEditCommitEvent): CrudCommand | null {
    // TODO: Implement edit command creation
    return null;
  }

  createInsertCommand(values: Record<string, unknown>): CrudCommand {
    // TODO: Implement insert command creation
    throw new Error('Not implemented');
  }

  createDeleteCommand(row: GridRowModel): CrudCommand {
    // TODO: Implement delete command creation
    throw new Error('Not implemented');
  }
}
```

**Step 2: Export SqlDataSource**

Modify `src/components/DataGrid/sources/index.ts`:

```typescript
export * from './types';
export * from './SqlDataSource';
```

**Step 3: Commit**

```bash
git add src/components/DataGrid/sources/
git commit -m "feat(datagrid): add SqlDataSource scaffold"
```

---

### Task 3: Write Test for SqlDataSource Instantiation

**Goal:** Verify SqlDataSource can be created with proper config.

**Files:**
- Create: `src/components/DataGrid/sources/__tests__/SqlDataSource.test.ts`

**Step 1: Write failing test**

Create `src/components/DataGrid/sources/__tests__/SqlDataSource.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SqlDataSource } from '../SqlDataSource';

describe('SqlDataSource', () => {
  describe('instantiation', () => {
    it('should create instance with correct paradigm and identifier', () => {
      const dataSource = new SqlDataSource({
        connectionId: 'conn-123',
        database: 'testdb',
        schema: 'public',
        table: 'users',
      });

      expect(dataSource.paradigm).toBe('sql');
      expect(dataSource.connectionId).toBe('conn-123');
      expect(dataSource.identifier).toEqual({
        type: 'table',
        database: 'testdb',
        schema: 'public',
        table: 'users',
      });
      expect(dataSource.editable).toBe(true);
    });

    it('should work without schema', () => {
      const dataSource = new SqlDataSource({
        connectionId: 'conn-456',
        database: 'testdb',
        table: 'posts',
      });

      expect(dataSource.identifier).toEqual({
        type: 'table',
        database: 'testdb',
        schema: undefined,
        table: 'posts',
      });
    });
  });

  describe('initial state', () => {
    it('should have empty columns and rows', () => {
      const dataSource = new SqlDataSource({
        connectionId: 'conn-123',
        database: 'testdb',
        table: 'users',
      });

      expect(dataSource.getColumns()).toEqual([]);
      expect(dataSource.getRowCount()).toBe(0);
      expect(dataSource.isLoading).toBe(false);
      expect(dataSource.hasMore).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it passes**

```bash
pnpm test:unit SqlDataSource.test.ts --run
```

Expected: ✓ All tests pass (SqlDataSource already implements the interface correctly)

**Step 3: Commit**

```bash
git add src/components/DataGrid/sources/__tests__/
git commit -m "test(datagrid): add SqlDataSource instantiation tests"
```

---

## Phase 2: Operation Executors

### Task 4: Create OperationExecutor Interface

**Goal:** Define the interface for paradigm-specific command execution and preview.

**Files:**
- Create: `src/services/operationExecutors/types.ts`
- Create: `src/services/operationExecutors/index.ts`

**Step 1: Write type definitions**

Create `src/services/operationExecutors/types.ts`:

```typescript
import type { CrudCommand } from '@/types/crud';

/**
 * Result of executing commands
 */
export interface ExecuteResult {
  success: boolean;
  affectedCount: number;
  errors: ExecuteError[];
}

export interface ExecuteError {
  commandId: string;
  message: string;
}

/**
 * Preview of operations before execution
 */
export interface OperationPreview {
  type: 'sql' | 'mongo-ops' | 'redis-cmds';
  content: string;           // Human-readable preview
  operations: PreviewOp[];   // Structured for diff viewer
}

export interface PreviewOp {
  action: string;            // 'insert', 'update', 'delete', 'set', 'hset', etc.
  target: string;            // table/collection/key name
  description: string;       // Human-readable description
  before?: unknown;          // Previous value (for updates/deletes)
  after?: unknown;           // New value (for inserts/updates)
}

/**
 * Validation result for a command
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Operation executor interface
 * Each database paradigm implements this for command execution
 */
export interface OperationExecutor {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';

  /**
   * Execute staged commands against the database
   */
  execute(commands: CrudCommand[]): Promise<ExecuteResult>;

  /**
   * Generate preview of what commands will do
   */
  preview(commands: CrudCommand[]): OperationPreview;

  /**
   * Validate a command before staging
   */
  validate(command: CrudCommand): ValidationResult;
}
```

**Step 2: Create barrel export**

Create `src/services/operationExecutors/index.ts`:

```typescript
export * from './types';
```

**Step 3: Commit**

```bash
git add src/services/operationExecutors/
git commit -m "feat(executors): add OperationExecutor interface and types"
```

---

### Task 5: Create SqlOperationExecutor

**Goal:** Implement SQL executor wrapping existing commandToSql logic.

**Files:**
- Create: `src/services/operationExecutors/SqlOperationExecutor.ts`
- Modify: `src/services/operationExecutors/index.ts`

**Step 1: Write SqlOperationExecutor class**

Create `src/services/operationExecutors/SqlOperationExecutor.ts`:

```typescript
import type { CrudCommand } from '@/types/crud';
import type { DbType } from '@/types/connection';
import type { DatabaseAdapter } from '@/adapters/types';
import { commandToSql, applyColumnRenames, applyTableRenames, trackColumnRename, trackTableRename } from '@/adapters';
import type { OperationExecutor, ExecuteResult, OperationPreview, ValidationResult, PreviewOp } from './types';
import { logger } from '@/lib/logger';

export class SqlOperationExecutor implements OperationExecutor {
  readonly paradigm = 'sql' as const;

  constructor(
    private adapter: DatabaseAdapter,
    private connectionId: string,
    private dbType: DbType,
  ) {}

  async execute(commands: CrudCommand[]): Promise<ExecuteResult> {
    if (commands.length === 0) {
      return { success: true, affectedCount: 0, errors: [] };
    }

    try {
      // Apply column/table renames to commands
      const { adjustedCommands, sqlStatements } = this.processCommands(commands);

      if (sqlStatements.length === 0) {
        throw new Error('No SQL statements generated from commands');
      }

      // Filter out comment-only statements
      const executableStatements = this.filterExecutableStatements(sqlStatements);

      if (executableStatements.length === 0) {
        throw new Error('All statements are unsupported operations');
      }

      // Wrap in transaction
      const transactionSql = this.adapter.transaction(executableStatements);

      logger.info('[SqlOperationExecutor] Executing transaction:', {
        connectionId: this.connectionId,
        commandCount: commands.length,
        statementCount: executableStatements.length,
      });

      // Execute via adapter
      await this.adapter.execute(transactionSql);

      return {
        success: true,
        affectedCount: commands.length,
        errors: [],
      };
    } catch (error) {
      logger.error('[SqlOperationExecutor] Execution failed:', error);
      return {
        success: false,
        affectedCount: 0,
        errors: [{
          commandId: commands[0]?.id ?? 'unknown',
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  preview(commands: CrudCommand[]): OperationPreview {
    const { sqlStatements } = this.processCommands(commands);
    const content = sqlStatements.join(';\n') + ';';

    const operations: PreviewOp[] = commands.map(cmd => ({
      action: cmd.type.split('.')[1] ?? 'unknown',
      target: cmd.target.table ?? 'unknown',
      description: cmd.metadata.description ?? cmd.type,
      before: (cmd.payload as any).oldValue,
      after: (cmd.payload as any).newValue ?? (cmd.payload as any).values,
    }));

    return {
      type: 'sql',
      content,
      operations,
    };
  }

  validate(command: CrudCommand): ValidationResult {
    // Basic validation: can we generate SQL?
    try {
      const sql = commandToSql(this.adapter, command);
      if (!sql) {
        return {
          valid: false,
          errors: ['Cannot generate SQL for this command'],
        };
      }
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private processCommands(commands: CrudCommand[]): {
    adjustedCommands: CrudCommand[];
    sqlStatements: string[];
  } {
    const columnRenames = new Map<string, string>();
    const tableRenames = new Map<string, string>();
    const adjustedCommands: CrudCommand[] = [];
    const sqlStatements: string[] = [];

    for (const cmd of commands) {
      // Apply renames
      const tableAdjustedCmd = applyTableRenames(cmd, tableRenames);
      const adjustedCmd = applyColumnRenames(tableAdjustedCmd, columnRenames);

      // Track renames for subsequent commands
      trackColumnRename(columnRenames, cmd, adjustedCmd);
      trackTableRename(tableRenames, cmd, tableAdjustedCmd);

      adjustedCommands.push(adjustedCmd);

      const sql = commandToSql(this.adapter, adjustedCmd);
      if (sql) {
        sqlStatements.push(sql);
      }
    }

    return { adjustedCommands, sqlStatements };
  }

  private filterExecutableStatements(statements: string[]): string[] {
    return statements.filter(sql => {
      const trimmed = sql.trim();
      if (trimmed.startsWith('--')) {
        const lines = trimmed.split('\n');
        return lines.some(line => {
          const lineTrimmed = line.trim();
          return lineTrimmed.length > 0 && !lineTrimmed.startsWith('--');
        });
      }
      return true;
    });
  }
}
```

**Step 2: Export SqlOperationExecutor**

Modify `src/services/operationExecutors/index.ts`:

```typescript
export * from './types';
export * from './SqlOperationExecutor';
```

**Step 3: Commit**

```bash
git add src/services/operationExecutors/
git commit -m "feat(executors): add SqlOperationExecutor implementation"
```

---

### Task 6: Create Executor Factory

**Goal:** Factory function to get the correct executor based on connection type.

**Files:**
- Create: `src/services/operationExecutors/factory.ts`
- Modify: `src/services/operationExecutors/index.ts`

**Step 1: Write factory function**

Create `src/services/operationExecutors/factory.ts`:

```typescript
import type { DbType } from '@/types/connection';
import type { OperationExecutor } from './types';
import { SqlOperationExecutor } from './SqlOperationExecutor';
import { getAdapter, getSqlAdapter } from '@/adapters';
import { getParadigm } from '@/types/connection';

const executorCache = new Map<string, OperationExecutor>();

/**
 * Get operation executor for a connection
 * Caches executors per connection ID
 */
export async function getOperationExecutor(
  connectionId: string,
  dbType: DbType,
): Promise<OperationExecutor> {
  // Check cache
  const cached = executorCache.get(connectionId);
  if (cached) {
    return cached;
  }

  // Create new executor based on paradigm
  const paradigm = getParadigm(dbType);
  let executor: OperationExecutor;

  switch (paradigm) {
    case 'sql': {
      const adapter = await getSqlAdapter(connectionId, dbType);
      executor = new SqlOperationExecutor(adapter, connectionId, dbType);
      break;
    }

    case 'document': {
      // TODO: Implement DocumentOperationExecutor in Phase 3
      throw new Error('Document executor not yet implemented');
    }

    case 'keyvalue': {
      // TODO: Implement KeyValueOperationExecutor in Phase 4
      throw new Error('KeyValue executor not yet implemented');
    }

    default:
      throw new Error(`Unsupported paradigm: ${paradigm}`);
  }

  executorCache.set(connectionId, executor);
  return executor;
}

/**
 * Clear cached executor for a connection
 */
export function clearOperationExecutor(connectionId: string): void {
  executorCache.delete(connectionId);
}

/**
 * Clear all cached executors
 */
export function clearAllOperationExecutors(): void {
  executorCache.clear();
}
```

**Step 2: Export factory**

Modify `src/services/operationExecutors/index.ts`:

```typescript
export * from './types';
export * from './SqlOperationExecutor';
export * from './factory';
```

**Step 3: Commit**

```bash
git add src/services/operationExecutors/
git commit -m "feat(executors): add executor factory with caching"
```

---

### Task 7: Write Tests for SqlOperationExecutor

**Goal:** Verify SqlOperationExecutor works correctly.

**Files:**
- Create: `src/services/operationExecutors/__tests__/SqlOperationExecutor.test.ts`

**Step 1: Write test file**

Create `src/services/operationExecutors/__tests__/SqlOperationExecutor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqlOperationExecutor } from '../SqlOperationExecutor';
import { DbType } from '@/types/connection';
import type { CrudCommand } from '@/types/crud';
import type { DatabaseAdapter } from '@/adapters/types';

// Mock adapter
const createMockAdapter = (): DatabaseAdapter => ({
  connectionId: 'test-conn',
  dbType: DbType.PostgreSQL,
  paradigm: 'sql',
  quoteIdentifier: (id: string) => `"${id}"`,
  quoteLiteral: (val: string) => `'${val}'`,
  transaction: (statements: string[]) => `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
  // Add other required methods...
} as any);

describe('SqlOperationExecutor', () => {
  let executor: SqlOperationExecutor;
  let mockAdapter: DatabaseAdapter;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    executor = new SqlOperationExecutor(mockAdapter, 'test-conn', DbType.PostgreSQL);
  });

  describe('paradigm', () => {
    it('should be sql', () => {
      expect(executor.paradigm).toBe('sql');
    });
  });

  describe('execute', () => {
    it('should return success for empty command list', async () => {
      const result = await executor.execute([]);

      expect(result).toEqual({
        success: true,
        affectedCount: 0,
        errors: [],
      });
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should execute commands and return success', async () => {
      const commands: CrudCommand[] = [{
        id: 'cmd-1',
        type: 'data.insert',
        target: {
          connectionId: 'test-conn',
          database: 'testdb',
          table: 'users',
        },
        payload: {
          values: { name: 'Alice', email: 'alice@example.com' },
        },
        metadata: {
          description: 'Insert user',
          affectedRows: 1,
          timestamp: Date.now(),
        },
      }];

      const result = await executor.execute(commands);

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  describe('preview', () => {
    it('should generate SQL preview', () => {
      const commands: CrudCommand[] = [{
        id: 'cmd-1',
        type: 'data.insert',
        target: {
          connectionId: 'test-conn',
          database: 'testdb',
          table: 'users',
        },
        payload: {
          values: { name: 'Bob' },
        },
        metadata: {
          description: 'Insert user',
          affectedRows: 1,
          timestamp: Date.now(),
        },
      }];

      const preview = executor.preview(commands);

      expect(preview.type).toBe('sql');
      expect(preview.content).toContain('INSERT');
      expect(preview.operations).toHaveLength(1);
      expect(preview.operations[0]?.action).toBe('insert');
    });
  });

  describe('validate', () => {
    it('should validate valid commands', () => {
      const command: CrudCommand = {
        id: 'cmd-1',
        type: 'data.insert',
        target: {
          connectionId: 'test-conn',
          database: 'testdb',
          table: 'users',
        },
        payload: {
          values: { name: 'Charlie' },
        },
        metadata: {
          description: 'Insert user',
          affectedRows: 1,
          timestamp: Date.now(),
        },
      };

      const result = executor.validate(command);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
```

**Step 2: Run test**

```bash
pnpm test:unit SqlOperationExecutor.test.ts --run
```

Expected: Tests should pass (may need to adjust based on actual adapter interface)

**Step 3: Commit**

```bash
git add src/services/operationExecutors/__tests__/
git commit -m "test(executors): add SqlOperationExecutor tests"
```

---

### Task 8: Integrate Executor into CrudStore

**Goal:** Replace direct SQL generation in crudStore with executor pattern.

**Files:**
- Modify: `src/stores/crudStore.ts`

**Step 1: Add executor import and usage**

Modify `src/stores/crudStore.ts` (around line 545-650):

```typescript
// Add import at top
import { getOperationExecutor } from '@/services/operationExecutors';

// Replace the commitChanges function implementation
commitChanges: async (tableKey) => {
  const commands = get().stagedCommands.get(tableKey) ?? [];
  const transactionId = nanoid();
  const startTime = performance.now();

  if (commands.length === 0) {
    return {
      transactionId,
      success: true,
      durationMs: 0,
      committed: [],
      failures: [],
    } satisfies CommitResult;
  }

  const { connectionId } = commands[0]?.target ?? {};
  if (!connectionId) {
    logger.error("Commands:", commands);
    throw new Error("CrudStore: Missing connectionId for staged commands");
  }

  // Get dbType from connection store
  const connection = useConnectionStore.getState().getConnection(connectionId);
  if (!connection) {
    throw new Error(`CrudStore: Connection not found: ${connectionId}`);
  }
  const dbType = connection.profile.db_type;

  // Mark table as committing
  set((state) => ({
    committingTableKeys: new Set(state.committingTableKeys).add(tableKey),
  }));

  try {
    // Get operation executor
    const executor = await getOperationExecutor(connectionId, dbType);

    logger.info('[CrudStore] Executing commands via executor:', {
      connectionId,
      commandCount: commands.length,
      paradigm: executor.paradigm,
    });

    // Execute via executor
    const execResult = await executor.execute(commands);

    if (!execResult.success) {
      throw new Error(execResult.errors[0]?.message ?? 'Execution failed');
    }

    const durationMs = Math.round(performance.now() - startTime);

    // Build success result
    const result: CommitResult = {
      transactionId,
      success: true,
      durationMs,
      committed: commands.map((cmd) => ({
        id: cmd.id,
        type: cmd.type,
        target: cmd.target,
        description: cmd.metadata.description,
        affectedRows: cmd.metadata.affectedRows,
      })),
      failures: [],
    };

    logger.info('[CrudStore] Commit succeeded:', result);

    return result;
  } catch (error) {
    // Unmark as committing on error
    set((state) => {
      const committingTableKeys = new Set(state.committingTableKeys);
      committingTableKeys.delete(tableKey);
      return { committingTableKeys };
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[CrudStore] Commit failed:', errorMessage);

    throw new Error(errorMessage);
  }
},
```

**Step 2: Run tests to verify no regression**

```bash
pnpm test:unit crudStore.test.ts --run
```

Expected: Existing crudStore tests should still pass

**Step 3: Commit**

```bash
git add src/stores/crudStore.ts
git commit -m "feat(crud): integrate OperationExecutor into crudStore"
```

---

### Task 9: Update GlobalChangesDialog for Executor Preview

**Goal:** Use executor.preview() instead of direct SQL generation.

**Files:**
- Modify: `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx`

**Step 1: Update preview generation**

Modify `src/components/GlobalChangesDialog/GlobalChangesDialog.tsx` (around line 247-274):

```typescript
// Add import at top
import { getOperationExecutor } from '@/services/operationExecutors';

// Replace the useEffect for SQL generation
useEffect(() => {
  const generatePreview = async () => {
    const commandsMap = new Map(connectionCommands);
    const allCommands: CrudCommand[] = [];
    commandsMap.forEach(commands => allCommands.push(...commands));

    if (allCommands.length === 0) {
      setGeneratedSQL('-- No changes to commit');
      return;
    }

    try {
      const executor = await getOperationExecutor(connectionId, dbType);
      const preview = executor.preview(allCommands);

      logger.info('[GlobalChangesDialog] Generated preview:', {
        type: preview.type,
        operationCount: preview.operations.length,
      });

      setGeneratedSQL(preview.content);
    } catch (error) {
      logger.error('[GlobalChangesDialog] Failed to generate preview:', error);
      setGeneratedSQL('-- Error generating preview');
    }
  };

  generatePreview();
}, [connectionCommands, connectionId, dbType]);
```

**Step 2: Update SQL editor dialect (handle non-SQL paradigms)**

Around line 770, update the CodeEditor to handle different preview types:

```typescript
<CodeEditor
  value={generatedSQL || "-- No preview generated"}
  readOnly={true}
  language="sql"  // TODO: Could be 'json' for mongo-ops, 'redis' for redis-cmds
  dialect={dbTypeToDialect[dbType]}
  lineNumbers={true}
  height="100%"
  minHeight="200px"
  maxHeight="50vh"
/>
```

**Step 3: Commit**

```bash
git add src/components/GlobalChangesDialog/GlobalChangesDialog.tsx
git commit -m "feat(dialog): use OperationExecutor for preview generation"
```

---

## Testing & Verification

### Task 10: Manual Testing

**Goal:** Verify Phase 1 & 2 don't break existing SQL functionality.

**Step 1: Start dev server**

```bash
pnpm tauri:dev
```

**Step 2: Test SQL table editing**

1. Connect to PostgreSQL/MySQL test database
2. Open a table in the grid
3. Edit a cell, verify changes are staged
4. Open GlobalChangesDialog (Cmd+S), verify SQL preview shows
5. Commit changes, verify they apply to database
6. Verify undo/redo still works

**Step 3: Check logs**

Verify executor is being used:
- Look for `[SqlOperationExecutor]` log messages
- Look for `[CrudStore] Executing commands via executor` logs

**Step 4: Document results**

If everything works, create summary:

```bash
git add .
git commit -m "chore: Phase 1 & 2 complete - executor foundation working"
```

---

## Next Steps

After Phase 1 & 2 are complete and verified:

1. **Phase 3: Document Support** - Implement DocumentDataSource and DocumentOperationExecutor
2. **Phase 4: KeyValue Support** - Implement KeyValueDataSource and KeyValueOperationExecutor
3. **Phase 5: Polish** - Add ViewModeToggle, keyboard shortcuts, remove deprecated components

---

## Notes

- **YAGNI**: Only implement what's needed for SQL paradigm in this phase
- **DRY**: Reuse existing `commandToSql` logic in SqlOperationExecutor
- **TDD**: Write tests first where possible, verify after each change
- **Frequent commits**: Commit after each task completion
- **No regression**: Existing SQL functionality must continue working perfectly
