// Unified DataGrid adapters (new architecture)
export { SqlDataGrid } from "./SqlDataGrid";
export type { SqlDataGridProps } from "./SqlDataGrid";

export { DocumentDataGrid } from "./DocumentDataGrid";
export type { DocumentDataGridProps } from "./DocumentDataGrid";

export { KeyValueDataGrid } from "./KeyValueDataGrid";
export type { KeyValueDataGridProps } from "./KeyValueDataGrid";

// Query result grid (read-only, for query panel results)
export { QueryResultGrid } from "./QueryResultGrid";
export type { QueryResultGridProps } from "./QueryResultGrid";

// Legacy adapter (kept for backward compatibility, will be removed)
export { TableDataGrid } from "./TableDataGrid";
export type { TableDataGridProps } from "./TableDataGrid";
