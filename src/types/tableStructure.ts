/**
 * Comprehensive table structure types
 */
import type { ColumnMeta } from '@/types/database';

export interface Index {
  name: string;
  table_name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  is_partial: boolean;
  definition: string;
  is_foreign_key: boolean;
}

export enum ConstraintType {
  PrimaryKey = "PrimaryKey",
  ForeignKey = "ForeignKey",
  Unique = "Unique",
  Check = "Check",
  Exclusion = "Exclusion",
}

export interface Constraint {
  name: string;
  table_name: string;
  constraint_type: ConstraintType;
  definition: string;
  foreign_table?: string;
}

export interface Trigger {
  name: string;
  schema: string;
  table_name: string;
  event: string;
  timing: string;
  level: string;
  enabled: boolean;
  function: string;
  condition?: string;
}

/**
 * Complete table structure information including all metadata
 */
export interface TableStructure {
  // Basic info
  name: string;
  schema: string;
  database: string;
  
  // Table metadata
  owner?: string;
  comment?: string;
  rowCount?: number;
  size?: string;
  
  // Structure details
  columns: ColumnMeta[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: Index[];
  constraints: Constraint[];
  triggers: Trigger[];
  
  // Statistics
  stats?: TableStatistics;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  foreignTable: string;
  foreignSchema?: string;
  foreignColumns: string[];
  onUpdate?: string;
  onDelete?: string;
}

export interface TableStatistics {
  totalRows: number;
  tableSize: string;
  indexSize: string;
  totalSize: string;
  lastAnalyzed?: Date;
  lastVacuum?: Date;
}

/**
 * Options for fetching table structure
 */
export interface TableStructureOptions {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  includeTriggers?: boolean;
  includeStatistics?: boolean;
  includeForeignKeys?: boolean;
}
