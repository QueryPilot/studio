export type CodeEditorLanguage = "sql" | "json" | "text" | "dbml";
export type SqlDialect = "postgresql" | "plsql" | "mysql" | "sqlite" | "mssql";
export type EditorTheme = "light" | "dark" | "auto";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onExecute?: (query?: string) => void;
  onEnter?: () => boolean; // Return true to prevent default behavior
  language?: CodeEditorLanguage;
  dialect?: SqlDialect;
  connectionId?: string;
  database?: string;
  schema?: string;
  readOnly?: boolean;
  height?: string;
  theme?: EditorTheme;
  placeholder?: string;
  autoFocus?: boolean;
  lineNumbers?: boolean;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
}

// --- Generic Smart Editor Interfaces ---
// These enable polyglot support (SQL, MongoDB, Redis, etc.)

export interface EntityMeta {
  name: string;
  type: "table" | "view" | "collection" | "index" | "materialized_view";
  schema?: string;
  description?: string;
}

export interface FieldMeta {
  name: string;
  dataType: string;
  parentEntity?: string;
  description?: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
}

/**
 * Detailed information about an entity for hover tooltips
 */
export interface EntityDetails {
  name: string;
  type: string;
  schema?: string;
  description?: string;
  rowCount?: number;
  fields?: FieldMeta[];
}

/**
 * Generic metadata provider interface for database introspection.
 * Implemented by SQL, MongoDB, Redis, etc. adapters.
 */
export interface MetadataProvider {
  /** List all entities (tables, collections, etc.) in a schema/namespace */
  listEntities(schema?: string): Promise<EntityMeta[]>;

  /** List all fields (columns, document fields, etc.) for an entity */
  listFields(entityName: string, schema?: string): Promise<FieldMeta[]>;

  /** Get detailed info about an entity (for hover tooltips) */
  getEntityDetails?(entityName: string, schema?: string): Promise<EntityDetails | null>;
}

/**
 * Context analysis result from the editor "Brain".
 * Language-agnostic representation of what the user is trying to complete.
 */
export interface EditorContextAnalysis {
  /** What is the user trying to complete? */
  intent: "entity" | "field" | "value" | "keyword" | "unknown";

  /** The specific entity being referenced (e.g., alias "u" -> table "users") */
  focusedEntity?: {
    name: string;
    schema?: string;
    alias?: string;
    isCTE?: boolean;
    cteColumns?: string[];
    cteSourceTable?: string;
  };

  /** All entities visible in the current scope */
  availableEntities: Array<{
    name: string;
    schema?: string;
    alias?: string;
    isCTE?: boolean;
    cteColumns?: string[];
    cteSourceTable?: string;
  }>;

  /** Text range to replace with completion */
  range: { from: number; to: number };
}
