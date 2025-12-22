/**
 * Distinct CRUD operation identifiers supported by the staging engine.
 */
export type CrudOperationType =
  | 'data.update'
  | 'data.insert'
  | 'data.delete'
  | 'table.create'
  | 'table.drop'
  | 'column.add'
  | 'column.modify'
  | 'column.drop'
  | 'column.rename'
  | 'index.create'
  | 'index.drop'
  | 'index.rename'
  | 'trigger.create'
  | 'trigger.drop'
  | 'trigger.enable'
  | 'trigger.disable'
  | 'fk.add'
  | 'fk.drop';

/**
 * Lifecycle states tracked for each staged command.
 */
export type CrudCommandState = 'staged' | 'committed' | 'failed';

/**
 * Severity levels applied to conflict and validation diagnostics.
 */
export type CrudDiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Common metadata captured for every CRUD command.
 */
export interface CrudCommandMetadata {
  /** ISO-8601 timestamp captured at command creation. */
  readonly timestamp: string;
  /** Optional short description for UI display. */
  readonly description?: string;
  /** Estimated or known row impact for data operations. */
  readonly affectedRows?: number;
  /** Identifier of the user that staged the command. */
  readonly userId?: string;
  /** Optional source descriptor (e.g. `ui`, `ai`). */
  readonly source?: string;
  /** Arbitrary metadata extensions. */
  readonly tags?: string[];
  /** Optional: Row key to insert new rows after (for INSERT commands). */
  readonly insertAfterRowKey?: string;
}

/**
 * Target resource for a CRUD command.
 */
export interface CrudCommandTarget {
  readonly connectionId: string;
  readonly database?: string;
  readonly schema?: string;
  readonly table?: string;
  /** Additional identifier for column / index / trigger targets. */
  readonly entityName?: string;
}

/**
 * Canonical error surface for CRUD command validation and execution.
 */
export interface CrudCommandError {
  readonly code: string;
  readonly message: string;
  readonly severity: CrudDiagnosticSeverity;
  readonly recoverable: boolean;
  readonly details?: Record<string, JsonValue>;
}

/**
 * Base shape for command payloads. Operation specific payloads should extend this interface.
 */
export interface CrudCommandPayload {
  /** Optional identifier for temporary entities (e.g. client-side IDs). */
  readonly tempId?: string;
  /** Allow arbitrary additional fields. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any;
}

/**
 * Column definition abstraction for structure commands.
 */
export interface ColumnDefinitionInput {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultValue?: JsonValue;
  readonly comment?: string;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly isPrimaryKey?: boolean;
  readonly isUnique?: boolean;
  readonly checkExpression?: string;
}

/**
 * Index definition abstraction for structure commands.
 */
export interface IndexDefinitionInput {
  readonly name: string;
  readonly columns: string[];
  readonly unique?: boolean;
  readonly using?: string;
  readonly where?: string;
  readonly includeColumns?: string[];
}

/**
 * Trigger definition abstraction for structure commands.
 */
export interface TriggerDefinitionInput {
  readonly name: string;
  readonly timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  readonly events: Array<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>;
  readonly functionName: string;
  readonly level?: 'ROW' | 'STATEMENT';
  readonly condition?: string;
  readonly enabled?: boolean;
  readonly comment?: string;
}

/**
 * Foreign key definition abstraction for structure commands.
 */
export interface ForeignKeyDefinitionInput {
  readonly name: string;
  readonly columns: string[];
  readonly referenceTable: string;
  readonly referenceSchema?: string;
  readonly referenceColumns: string[];
  readonly onUpdate?: string;
  readonly onDelete?: string;
  readonly deferrable?: boolean;
  readonly initiallyDeferred?: boolean;
}

export interface DataUpdatePayload extends CrudCommandPayload {
  readonly column: string;
  readonly columnType?: string; // PostgreSQL type for explicit casting (e.g., "money", "inet")
  readonly primaryKeys: Record<string, CrudPrimitive>;
  readonly oldValue?: JsonValue;
  readonly newValue: JsonValue;
}

export interface DataInsertPayload extends CrudCommandPayload {
  readonly values: Record<string, JsonValue>;
  readonly columnTypes?: Record<string, string>; // PostgreSQL types for explicit casting
  readonly primaryKeys?: Record<string, CrudPrimitive>;
}

export interface DataDeletePayload extends CrudCommandPayload {
  readonly primaryKeys: Record<string, CrudPrimitive>;
}

export interface ColumnAddPayload extends CrudCommandPayload {
  readonly column: ColumnDefinitionInput;
}

export interface ColumnModifyPayload extends CrudCommandPayload {
  readonly columnName: string;
  readonly newDefinition: ColumnDefinitionInput;
}

export interface ColumnDropPayload extends CrudCommandPayload {
  readonly columnName: string;
  readonly cascade?: boolean;
}

export interface ColumnRenamePayload extends CrudCommandPayload {
  readonly columnName: string;
  readonly newName: string;
}

export interface IndexCreatePayload extends CrudCommandPayload {
  readonly definition: IndexDefinitionInput;
}

export interface IndexDropPayload extends CrudCommandPayload {
  readonly indexName: string;
  readonly ifExists?: boolean;
}

export interface IndexRenamePayload extends CrudCommandPayload {
  readonly indexName: string;
  readonly newName: string;
}

export interface TriggerCreatePayload extends CrudCommandPayload {
  readonly definition: TriggerDefinitionInput;
}

export interface TriggerDropPayload extends CrudCommandPayload {
  readonly triggerName: string;
  readonly ifExists?: boolean;
}

export interface TriggerTogglePayload extends CrudCommandPayload {
  readonly triggerName: string;
  readonly enable: boolean;
}

export interface ForeignKeyAddPayload extends CrudCommandPayload {
  readonly definition: ForeignKeyDefinitionInput;
}

export interface ForeignKeyDropPayload extends CrudCommandPayload {
  readonly constraintName: string;
  readonly cascade?: boolean;
}

export interface TableCreatePayload extends CrudCommandPayload {
  readonly tableName: string;
  readonly columns: ColumnDefinitionInput[];
  readonly primaryKey?: string[];
  readonly ifNotExists?: boolean;
}

export interface TableDropPayload extends CrudCommandPayload {
  readonly tableName: string;
  readonly cascade?: boolean;
  readonly ifExists?: boolean;
}

export type CrudCommandPayloadMap = {
  'data.update': DataUpdatePayload;
  'data.insert': DataInsertPayload;
  'data.delete': DataDeletePayload;
  'table.create': TableCreatePayload;
  'table.drop': TableDropPayload;
  'column.add': ColumnAddPayload;
  'column.modify': ColumnModifyPayload;
  'column.drop': ColumnDropPayload;
  'column.rename': ColumnRenamePayload;
  'index.create': IndexCreatePayload;
  'index.drop': IndexDropPayload;
  'index.rename': IndexRenamePayload;
  'trigger.create': TriggerCreatePayload;
  'trigger.drop': TriggerDropPayload;
  'trigger.enable': TriggerTogglePayload;
  'trigger.disable': TriggerTogglePayload;
  'fk.add': ForeignKeyAddPayload;
  'fk.drop': ForeignKeyDropPayload;
};

/**
 * Core CRUD command abstraction used throughout the staging pipeline.
 */
export interface CrudCommand<TPayload extends CrudCommandPayload = CrudCommandPayload> {
  readonly id: string;
  readonly type: CrudOperationType;
  readonly target: CrudCommandTarget;
  readonly payload: TPayload;
  readonly metadata: CrudCommandMetadata;
  readonly state: CrudCommandState;
  readonly error?: CrudCommandError;
}

export type CrudCommandFor<TType extends CrudOperationType> = CrudCommand<
  CrudCommandPayloadMap[TType]
>;

/**
 * Lightweight summary for displaying staged command previews.
 */
export interface CrudCommandSummary {
  readonly id: string;
  readonly type: CrudOperationType;
  readonly target: CrudCommandTarget;
  readonly description?: string;
  readonly affectedRows?: number;
}

/**
 * Detailed failure record emitted when a command fails validation or execution.
 */
export interface CrudCommandFailure extends CrudCommandSummary {
  readonly error: CrudCommandError;
  readonly rolledBack: boolean;
}

/**
 * Result returned after attempting to commit a group of staged commands.
 */
export interface CommitResult {
  readonly transactionId: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly committed: CrudCommandSummary[];
  readonly failures: CrudCommandFailure[];
  readonly warnings?: CrudCommandError[];
}

/**
 * Statement emitted by the SQL diff generator for preview and execution.
 */
export interface SqlDiffStatement {
  readonly id: string;
  readonly commandId: string;
  readonly statement: string;
  readonly dialect: string;
  readonly beforeDependencies?: string[];
  readonly afterDependencies?: string[];
}

/**
 * High-level artifact produced by the diff engine for UI rendering.
 */
export interface CrudDiffArtifact {
  readonly tableKey: string;
  readonly commands: CrudCommand[];
  readonly statements: SqlDiffStatement[];
  readonly conflicts: CrudDiffConflict[];
  readonly impacts: CrudImpactSummary[];
}

/**
 * Records conflicts detected between staged commands or with live schema.
 */
export interface CrudDiffConflict {
  readonly id: string;
  readonly severity: CrudDiagnosticSeverity;
  readonly message: string;
  readonly relatedCommandIds: string[];
  readonly resolutionHint?: string;
}

/**
 * Aggregate impact assessment for staged changes.
 */
export interface CrudImpactSummary {
  readonly type: 'rowImpact' | 'schemaChange' | 'performance' | 'warning';
  readonly severity: CrudDiagnosticSeverity;
  readonly message: string;
  readonly details?: Record<string, JsonValue>;
}

/**
 * Encapsulates the result of validating and staging a new command.
 */
export interface StageCommandResult {
  readonly command: CrudCommand;
  readonly warnings?: CrudCommandError[];
  readonly conflicts?: CrudDiffConflict[];
}

/**
 * Helper describing grouped staged commands keyed by table identifier.
 */
export interface StagedCommandGroup {
  readonly tableKey: string;
  readonly commands: CrudCommand[];
  readonly lastUpdatedAt: string;
}

/**
 * Arbitrary JSON-like primitive or structured value.
 */
export type CrudPrimitive = string | number | boolean | null;

/**
 * Deeply nested JSON-compatible value representation.
 */
export type JsonValue =
  | CrudPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Convenience type representing a row diff for data previews.
 */
export interface DataRowDiff {
  readonly primaryKey: Record<string, CrudPrimitive>;
  readonly before?: Record<string, CrudPrimitive>;
  readonly after?: Record<string, CrudPrimitive>;
  readonly operation?: 'insert' | 'update' | 'delete';
}

/**
 * Diff payload describing structural alterations.
 */
export interface StructureDiffEntry {
  readonly path: string;
  readonly changeType: 'added' | 'removed' | 'modified';
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

/**
 * Collects data and structure diffs for rendering in the UI.
 */
export interface CrudDiffSnapshot {
  readonly tableKey: string;
  readonly dataDiff: DataRowDiff[];
  readonly structureDiff: StructureDiffEntry[];
  readonly sqlStatements: SqlDiffStatement[];
  readonly conflicts: CrudDiffConflict[];
  readonly impacts: CrudImpactSummary[];
}


