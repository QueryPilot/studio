/**
 * Barrel exports for commonly used types.
 * Import from "@/types" instead of individual files.
 */

// Schema types (canonical source for column metadata)
export type {
  ColumnMeta,
  ForeignKeyRef,
  EnhancedColumnMeta,
  TableMeta,
  TableKind,
  IndexMeta,
  ConstraintMeta,
  ConstraintType,
  TriggerMeta,
  RoutineMeta,
  SequenceMeta,
  TypeMeta,
} from "./schema";

// Cell value types (for grid rendering)
export type {
  GridCellValue,
  GridCellValueType,
  GridCellMetadata,
  // Legacy exports (deprecated, use Grid* versions)
  CellValue,
  CellValueType,
  CellMetadata,
} from "./cellValue";

// Database types
export type {
  DatabaseType,
  DatabaseConnection,
  ConnectionStatus,
  QueryResult,
  TableInfo,
  ViewInfo,
  FunctionInfo,
  TriggerInfo,
  ColumnInfo,
  Tag,
} from "./database";

// Connection types
export {
  DbType,
  SslMode,
} from "./connection";
export type {
  ConnectionProfile,
  SslConfig,
  SshTunnelConfig,
  SshAuthMethod,
  BastionConfig,
  StoredConnection,
  ConnectionMetadata,
  ActiveConnectionState,
  WindowStates,
  ConnectionChangedEvent,
  ConnectionDeletedEvent,
} from "./connection";

// Filter types
export type {
  FilterCondition,
  FilterGroup,
  FilterConfig,
  SortConfig,
  LogicalOperator,
} from "./filter";

// CRUD types
export type {
  CrudOperationType,
  CrudCommandState,
  CrudDiagnosticSeverity,
  CrudCommandMetadata,
  CrudCommandTarget,
  CrudCommandError,
  CrudCommandPayload,
  CrudCommand,
  CrudCommandFor,
  CrudCommandSummary,
  CrudCommandFailure,
  CommitResult,
  JsonValue,
  CrudPrimitive,
  DataRowDiff,
  // Payload types
  DataUpdatePayload,
  DataInsertPayload,
  DataDeletePayload,
  ColumnAddPayload,
  ColumnModifyPayload,
  ColumnDropPayload,
  ColumnRenamePayload,
  IndexCreatePayload,
  IndexDropPayload,
  IndexRenamePayload,
  TriggerCreatePayload,
  TriggerDropPayload,
  TriggerTogglePayload,
  ForeignKeyAddPayload,
  ForeignKeyDropPayload,
  // Definition types
  ColumnDefinitionInput,
  IndexDefinitionInput,
  TriggerDefinitionInput,
  ForeignKeyDefinitionInput,
  // Diff types
  SqlDiffStatement,
  CrudDiffArtifact,
  CrudDiffConflict,
  CrudImpactSummary,
  StageCommandResult,
  StagedCommandGroup,
  StructureDiffEntry,
  CrudDiffSnapshot,
} from "./crud";

// Workbench types
export type {
  Orientation,
  PanelType,
  Direction,
  DropPosition,
  GridNode,
  TabMetadata,
  PanelContent,
  SplitAction,
  WorkbenchConstraints,
  DragDropContext,
  ResizeContext,
} from "./workbench";

// Workspace types
export type {
  TabType,
  TabState,
  ColumnFilter,
  WorkspaceSettings,
  WorkspaceState,
  WorkspaceStore,
  SerializableTabState,
  SerializableWorkspaceState,
  SerializableWorkspaceStore,
} from "./workspace";

// Command types
export type {
  CommandHandler,
  CommandExecutionContext,
  Command,
  CommandRegistration,
  CommandDescriptor,
} from "./command";

// Keybinding types
export type {
  KeybindingSource,
  Keybinding,
  ParsedKeybinding,
  ResolvedKeybinding,
  KeybindingMatch,
  KeybindingConflict,
  KeybindingSerialization,
} from "./keybinding";
