/**
 * Foreign Key Relationship Types for Smart SQL Intellisense
 */

export interface ForeignKeyRelationship {
  /** Source table that has the FK column */
  sourceTable: string;
  /** Source schema */
  sourceSchema: string;
  /** Column name in source table */
  sourceColumn: string;

  /** Referenced/target table */
  targetTable: string;
  /** Referenced schema */
  targetSchema: string;
  /** Referenced column (usually PK) */
  targetColumn: string;

  /** Constraint name */
  constraintName: string;

  /** ON DELETE action */
  onDelete?: string;
  /** ON UPDATE action */
  onUpdate?: string;
}

export interface TableRelationshipGraph {
  /** Map of table name to its relationships */
  relationships: Map<string, ForeignKeyRelationship[]>;

  /** Reverse map for quick lookup of which tables reference this one */
  reverseRelationships: Map<string, ForeignKeyRelationship[]>;
}

export interface JoinSuggestion {
  /** Table to join */
  table: string;
  /** Schema of the table */
  schema?: string;
  /** Suggested ON condition */
  onCondition: string;
  /** Type of join relationship (1:1, 1:n, n:1) */
  relationshipType: "one-to-one" | "one-to-many" | "many-to-one";
  /** Score for ranking suggestions */
  score: number;
  /** Human-readable description */
  description?: string;
}
