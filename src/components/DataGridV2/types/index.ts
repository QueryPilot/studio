import type {
  DataEditorRef,
  GridCell,
  GridColumn,
  GridSelection,
  Item,
  Rectangle,
  CustomCell,
  Theme,
  ImageWindowLoader,
  ProvideEditorCallback,
} from "@glideapps/glide-data-grid";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { ColumnMeta, CellValue } from "@/types";

export type GridRowModel = TableDataRow;
export type { Item };

export type SortDirection = 'asc' | 'desc';

export interface SortColumn {
  columnId: string;
  direction: SortDirection;
}

export interface GridSortState {
  sortColumns: SortColumn[];
}

export interface GridColumnV2 extends Omit<GridColumn, 'title'> {
  /** Stable identifier for persistence */
  id: string;
  /** Column key used to read values from a row */
  field: string;
  /** Display title for the column */
  title: string;
  /** Display name for the column (alias for title) */
  name: string;
  /** Column data type */
  type?: string;
  /** Original database metadata when available */
  meta?: ColumnMeta | null;
  /** Column width in pixels */
  width?: number;
  /** Minimum width constraint applied during auto-sizing */
  minWidth?: number;
  /** Maximum width constraint applied during auto-sizing */
  maxWidth?: number;
  /** Whether the column is currently hidden */
  isVisible?: boolean;
  /** Whether the column is currently pinned */
  isPinned?: boolean;
}

export interface GridColumnsState {
  order: string[];
  widths: Record<string, number>;
  visibility: Record<string, boolean>;
  pinned: string[];
}

export interface SerializedSelectionRange {
  start: number;
  end: number;
}

export interface SerializedGridSelection {
  rows: SerializedSelectionRange[];
  columns: SerializedSelectionRange[];
  current?: {
    cell: Item;
    range: Rectangle;
    rangeStack?: Rectangle[];
  };
  columnSelect?: boolean;
  rowSelect?: boolean;
}

export interface GridViewState {
  selection?: SerializedGridSelection;
  activeCell?: Item | null;
  scrollOffset?: {
    x: number;
    y: number;
  };
  pinnedColumns?: string[];
  pinnedRows?: string[];
}

export interface GridHistoryEntry<TMetadata = unknown> {
  id?: string;
  label?: string;
  undo: () => void;
  redo: () => void;
  metadata?: TMetadata;
  timestamp?: number;
}

export interface PushHistoryOptions {
  /** If true, redo is executed immediately after push. */
  applyRedo?: boolean;
}

export interface GridEditCoordinates {
  cell: Item;
  rowIndex: number;
  columnIndex: number;
  column: GridColumnV2;
  row: GridRowModel | undefined;
}

export interface GridEditCommitEvent extends GridEditCoordinates {
  newValue: GridCell;
  previousValue: CellValue | null | undefined;
}

export interface GridPasteEvent {
  /** Top-left coordinate where pasted data should begin */
  target: Item;
  /** Two-dimensional matrix of pasted values */
  values: (string | number | boolean | null)[][];
}

export interface GridRowAppendEvent {
  position: "top" | "bottom" | number;
  draftRow: GridRowModel;
}

export interface GridRowInsertEvent {
  index: number;
  rows: GridRowModel[];
}

export interface GridRowDeleteEvent {
  selection: GridSelection;
  rowIndexes: number[];
  rows: GridRowModel[];
}

export interface GridCallbacks {
  onColumnsChange?: (state: GridColumnsState) => void;
  onSelectionChange?: (selection: GridSelection) => void;
  onVisibleRegionChange?: (region: Rectangle) => void;
  onCellEditStart?: (event: GridEditCoordinates) => void;
  onCellEditCommit?: (
    event: GridEditCommitEvent,
  ) => GridHistoryEntry | undefined | Promise<GridHistoryEntry | undefined>;
  onCellEditCancel?: (event: GridEditCoordinates) => void;
  onRowAppend?: (
    event: GridRowAppendEvent,
  ) => GridHistoryEntry | undefined | Promise<GridHistoryEntry | undefined>;
  onRowInsert?: (event: GridRowInsertEvent) => GridHistoryEntry | undefined;
  onRowDelete?: (event: GridRowDeleteEvent) => GridHistoryEntry | undefined;
  onPaste?: (event: GridPasteEvent) =>
    | GridRowInsertEvent
    | GridHistoryEntry
    | boolean
    | undefined
    | Promise<GridRowInsertEvent | GridHistoryEntry | boolean | undefined>;
  onCopy?: (selection: GridSelection, asJson: boolean) => void;
  onRequestMoreData?: (range: Rectangle) => void;
  createDraftRow?: (position: "top" | "bottom" | number) => GridRowModel;
}

export type { DataEditorRef };

// Custom cell renderer types
export interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  rect: Rectangle;
  hoverAmount: number;
  hoverX: number | undefined;
  hoverY: number | undefined;
  col: number;
  row: number;
  highlighted: boolean;
  imageLoader: ImageWindowLoader;
}

export type CustomCellRenderer<T extends CustomCell> = {
  isMatch: (cell: CustomCell) => cell is T;
  draw: (args: DrawArgs, cell: T) => boolean;
  provideEditor: ProvideEditorCallback<T>;
};
