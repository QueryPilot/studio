/**
 * Distinct CRUD operation identifiers supported by the staging engine.
 */
export type CrudOperationType =
  | "data.update"
  | "data.insert"
  | "data.delete"
  | "table.create"
  | "table.rename"
  | "table.drop"
  | "table.truncate"
  | "table.duplicate"
  | "column.add"
  | "column.modify"
  | "column.drop"
  | "column.rename"
  | "index.create"
  | "index.drop"
  | "index.rename"
  | "trigger.create"
  | "trigger.drop"
  | "trigger.rename"
  | "trigger.enable"
  | "trigger.disable"
  | "fk.add"
  | "fk.drop"
  | "view.create"
  | "view.drop"
  | "view.replace"
  | "view.rename"
  | "constraint.addPrimaryKey"
  | "constraint.dropPrimaryKey"
  | "constraint.addUnique"
  | "constraint.dropUnique"
  | "constraint.addCheck"
  | "constraint.dropCheck"
  | "constraint.drop"
  | "constraint.rename"
  | "sequence.create"
  | "sequence.alter"
  | "sequence.drop"
  | "sequence.rename";

/**
 * Lifecycle states tracked for each staged command.
 */
export type CrudCommandState = "staged" | "committed" | "failed";

/**
 * Severity levels applied to conflict and validation diagnostics.
 */
export type CrudDiagnosticSeverity = "info" | "warning" | "error";

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
  readonly timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  readonly events: Array<"INSERT" | "UPDATE" | "DELETE" | "TRUNCATE">;
  readonly functionName: string;
  readonly level?: "ROW" | "STATEMENT";
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

/**
 * View definition abstraction for structure commands.
 */
export interface ViewDefinitionInput {
  readonly name: string;
  readonly definition: string; // SQL query defining the view
  readonly isMaterialized?: boolean;
  readonly comment?: string;
  readonly checkOption?: "CASCADED" | "LOCAL"; // WITH CHECK OPTION
  readonly securityBarrier?: boolean; // PostgreSQL security_barrier
  readonly securityInvoker?: boolean; // PostgreSQL security_invoker
}

/**
 * Constraint definition abstraction for structure commands.
 */
export interface ConstraintDefinitionInput {
  readonly name: string;
  readonly type: "primary_key" | "unique" | "check" | "exclusion";
  readonly columns?: string[]; // For PK, unique
  readonly expression?: string; // For check constraints
  readonly indexMethod?: string; // For exclusion constraints (e.g., GIST)
  readonly comment?: string;
  readonly deferrable?: boolean;
  readonly initiallyDeferred?: boolean;
}

/**
 * Sequence definition abstraction for structure commands.
 */
export interface SequenceDefinitionInput {
  readonly name: string;
  readonly increment?: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly startValue?: number;
  readonly cache?: number;
  readonly cycle?: boolean;
  readonly ownedBy?: string; // Format: "table_name.column_name"
  readonly comment?: string;
}

export interface DataUpdatePayload extends CrudCommandPayload {
  readonly column: string;
  readonly columnType?: string; // PostgreSQL type for explicit casting (e.g., "money", "inet")
  readonly primaryKeys: Record<string, JsonValue>;
  readonly oldValue?: JsonValue;
  readonly newValue: JsonValue;
}

export interface DataInsertPayload extends CrudCommandPayload {
  readonly values: Record<string, JsonValue>;
  readonly columnTypes?: Record<string, string>; // PostgreSQL types for explicit casting
  readonly primaryKeys?: Record<string, CrudPrimitive>;
}

export interface DataDeletePayload extends CrudCommandPayload {
  readonly primaryKeys: Record<string, JsonValue>;
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

export interface TriggerRenamePayload extends CrudCommandPayload {
  readonly triggerName: string;
  readonly newName: string;
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

export interface TableRenamePayload extends CrudCommandPayload {
  readonly newName: string;
}

export interface TableDropPayload extends CrudCommandPayload {
  readonly tableName: string;
  readonly cascade?: boolean;
  readonly ifExists?: boolean;
}

export interface TableTruncatePayload extends CrudCommandPayload {
  readonly tableName: string;
  readonly restartIdentity?: boolean; // Reset sequences/auto-increment
  readonly cascade?: boolean; // Cascade to dependent tables
}

export interface TableDuplicatePayload extends CrudCommandPayload {
  readonly sourceTableName: string;
  readonly newTableName: string;
  readonly includeData?: boolean; // Clone rows
  readonly includeIndexes?: boolean; // Clone indexes
  readonly includeConstraints?: boolean; // Clone FK, checks, etc
  readonly includeTriggers?: boolean; // Clone triggers
}

// ============================================================================
// View Operation Payloads
// ============================================================================

export interface ViewCreatePayload extends CrudCommandPayload {
  readonly definition: ViewDefinitionInput;
}

export interface ViewDropPayload extends CrudCommandPayload {
  readonly viewName: string;
  readonly ifExists?: boolean;
  readonly cascade?: boolean;
  readonly isMaterialized?: boolean;
}

export interface ViewReplacePayload extends CrudCommandPayload {
  readonly viewName: string;
  readonly definition: string; // New SQL query
  readonly isMaterialized?: boolean;
}

export interface ViewRenamePayload extends CrudCommandPayload {
  readonly viewName: string;
  readonly newName: string;
  readonly isMaterialized?: boolean;
}

// ============================================================================
// Constraint Operation Payloads
// ============================================================================

export interface ConstraintAddPayload extends CrudCommandPayload {
  readonly definition: ConstraintDefinitionInput;
}

export interface ConstraintDropPayload extends CrudCommandPayload {
  readonly constraintName: string;
  readonly cascade?: boolean;
  readonly ifExists?: boolean;
}

export interface ConstraintRenamePayload extends CrudCommandPayload {
  readonly constraintName: string;
  readonly newName: string;
}

// ============================================================================
// Sequence Operation Payloads
// ============================================================================

export interface SequenceCreatePayload extends CrudCommandPayload {
  readonly definition: SequenceDefinitionInput;
}

export interface SequenceAlterPayload extends CrudCommandPayload {
  readonly sequenceName: string;
  readonly changes: Partial<SequenceDefinitionInput>;
}

export interface SequenceDropPayload extends CrudCommandPayload {
  readonly sequenceName: string;
  readonly ifExists?: boolean;
  readonly cascade?: boolean;
}

export interface SequenceRenamePayload extends CrudCommandPayload {
  readonly sequenceName: string;
  readonly newName: string;
}

export type CrudCommandPayloadMap = {
  "data.update": DataUpdatePayload;
  "data.insert": DataInsertPayload;
  "data.delete": DataDeletePayload;
  "table.create": TableCreatePayload;
  "table.rename": TableRenamePayload;
  "table.drop": TableDropPayload;
  "table.truncate": TableTruncatePayload;
  "table.duplicate": TableDuplicatePayload;
  "column.add": ColumnAddPayload;
  "column.modify": ColumnModifyPayload;
  "column.drop": ColumnDropPayload;
  "column.rename": ColumnRenamePayload;
  "index.create": IndexCreatePayload;
  "index.drop": IndexDropPayload;
  "index.rename": IndexRenamePayload;
  "trigger.create": TriggerCreatePayload;
  "trigger.drop": TriggerDropPayload;
  "trigger.rename": TriggerRenamePayload;
  "trigger.enable": TriggerTogglePayload;
  "trigger.disable": TriggerTogglePayload;
  "fk.add": ForeignKeyAddPayload;
  "fk.drop": ForeignKeyDropPayload;
  "view.create": ViewCreatePayload;
  "view.drop": ViewDropPayload;
  "view.replace": ViewReplacePayload;
  "view.rename": ViewRenamePayload;
  "constraint.addPrimaryKey": ConstraintAddPayload;
  "constraint.dropPrimaryKey": ConstraintDropPayload;
  "constraint.addUnique": ConstraintAddPayload;
  "constraint.dropUnique": ConstraintDropPayload;
  "constraint.addCheck": ConstraintAddPayload;
  "constraint.dropCheck": ConstraintDropPayload;
  "constraint.drop": ConstraintDropPayload;
  "constraint.rename": ConstraintRenamePayload;
  "sequence.create": SequenceCreatePayload;
  "sequence.alter": SequenceAlterPayload;
  "sequence.drop": SequenceDropPayload;
  "sequence.rename": SequenceRenamePayload;
};

/**
 * Core CRUD command abstraction used throughout the staging pipeline.
 */
export interface CrudCommand<
  TPayload extends CrudCommandPayload = CrudCommandPayload,
> {
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
  readonly type: "rowImpact" | "schemaChange" | "performance" | "warning";
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
  readonly primaryKey: Record<string, JsonValue>;
  readonly before?: Record<string, JsonValue>;
  readonly after?: Record<string, JsonValue>;
  readonly operation?: "insert" | "update" | "delete";
}

/**
 * Diff payload describing structural alterations.
 */
export interface StructureDiffEntry {
  readonly path: string;
  readonly changeType: "added" | "removed" | "modified";
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
