/**
 * Comprehensive table structure types
 */
import type { ColumnMeta } from '@/types/database';
import type { Index, Constraint, Trigger } from '@/services/backend';

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