/**
 * Core types for the Smart Editor engine.
 * These interfaces enable polyglot support (SQL, MongoDB, Redis, etc.)
 */

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
 * Suggested JOIN condition based on foreign key relationships
 */
export interface JoinConditionSuggestion {
  /** The full ON condition string (e.g., "orders.customer_id = customers.id") */
  condition: string;
  /** Human-readable description */
  description: string;
  /** Source of the suggestion: "fk" for foreign key, "column_match" for name-based heuristic */
  source: "fk" | "column_match";
  /** Priority score (higher = better match) */
  score: number;
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

  /**
   * Get suggested JOIN conditions between tables in scope and a target table.
   * Returns conditions based on FK relationships and column name matching.
   */
  getJoinConditions?(
    tablesInScope: Array<{ name: string; alias?: string; schema?: string }>,
    targetTable: { name: string; alias?: string; schema?: string },
    schema?: string
  ): Promise<JoinConditionSuggestion[]>;

  /**
   * List database functions in the given schema.
   * Returns user-defined and built-in functions from the database.
   */
  listFunctions?(schema?: string): Promise<FunctionMeta[]>;
}

/**
 * Metadata about a database function
 */
export interface FunctionMeta {
  name: string;
  returnType: string;
  arguments: string;
  description?: string;
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
