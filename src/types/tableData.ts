// Table data reading types

export interface TableReadRequest {
  connectionId: string;
  table: string;
  schema?: string;
  select?: string[];
  sorts?: SortSpec[];
  filters?: FilterSpec[];
  search?: string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface FilterSpec {
  column: string;
  operator: FilterOperator;
  value: any;
}

export type FilterOperator = 
  | '=' 
  | '!=' 
  | '<' 
  | '<=' 
  | '>' 
  | '>=' 
  | 'LIKE' 
  | 'ILIKE' 
  | 'IN' 
  | 'IS NULL' 
  | 'IS NOT NULL' 
  | 'BETWEEN';

export interface ColumnMeta {
  name: string;
  dbType: string;
  nullable: boolean;
  default?: string;
  isPk: boolean;
  isFk: boolean;
  ordinal: number;
  precision?: number;
  scale?: number;
  isIdentity?: boolean;
  isComputed?: boolean;
  isHierarchyid?: boolean;
  isSpatial?: boolean;
  isJson?: boolean;
  enumValues?: string[];
  setValues?: string[];
  isVirtual?: boolean;
}

export type TableDataResponse = 
  | TableDataMeta
  | TableDataRows
  | TableDataDone
  | TableDataError;

export interface TableDataMeta {
  type: 'meta';
  table: string;
  schema?: string;
  columns: ColumnMeta[];
  selected: string[];
  pageSize: number;
  cursorKeyColumns: string[];
}

export interface TableDataRows {
  type: 'rows';
  rows: Record<string, any>[];
  nextCursor?: string;
}

export interface TableDataDone {
  type: 'done';
}

export interface TableDataError {
  type: 'error';
  code: string;
  message: string;
}

// Helper type for table data stream
export interface TableDataStream {
  streamId: string;
  meta?: TableDataMeta;
  rows: Record<string, any>[];
  error?: TableDataError;
  isComplete: boolean;
  nextCursor?: string;
}