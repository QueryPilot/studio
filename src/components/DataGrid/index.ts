// Legacy virtual scrolling components (to be deprecated)
export { OptimizedVirtualDataGrid } from "./OptimizedVirtualDataGrid";
export { OptimizedVirtualDataGrid as LegacyTableDataGrid } from "./OptimizedVirtualDataGrid"; // Legacy alias
export { QueryDataGrid as LegacyQueryDataGrid } from "./QueryDataGrid";

// New Glide Data Grid components (recommended)
export { GlideTableDataGrid as TableDataGrid } from "./glide/GlideTableDataGrid";
export { GlideQueryDataGrid as QueryDataGrid } from "./glide/GlideQueryDataGrid";

// Export Glide components directly
export { GlideTableDataGrid, GlideQueryDataGrid } from "./glide";

// Cell components
export { CellValueRenderer } from "./cells/CellValueRenderer";

// State components
export {
  DataGridErrorState,
  DataGridEmptyState,
  DataGridLoadingIndicator,
  DataGridEndOfData,
} from "./components/DataGridStates";

// Core components
export { OptimizedDataGridHeader } from "./components/OptimizedDataGridHeader";
export { OptimizedDataGridHeader as DataGridHeader } from "./components/OptimizedDataGridHeader"; // Alias for compatibility
export { DataGridSkeleton } from "./components/DataGridSkeleton";

// Hooks
export { useInfiniteTableData } from "./hooks/useInfiniteTableData";