import type { GridColumnV2, GridRowModel } from "../../types";

export type InspectorTab = "tree" | "diff" | "raw";

export interface InspectorPanelProps {
  selectedRows: GridRowModel[];
  columns: GridColumnV2[];
  /** The panel shell closes over the selected row indexes when constructing this callback. */
  onCellEdit?: (field: string, value: unknown) => void;
  /** Column field keys that have pending (staged) edits for the selected rows. */
  pendingEditFields?: Set<string>;
  /** Unstage all pending edits for the given column field key across selected rows. */
  onUndoCellEdit?: (field: string) => void;
  className?: string;
  defaultTab?: InspectorTab;
  /** Controlled active tab — when provided, takes precedence over defaultTab. */
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
}

export interface InspectorDocument {
  [key: string]: unknown;
}

/** Merged field value for multi-record tree view */
export type MergedFieldValue =
  | { kind: "same"; value: unknown }
  | { kind: "multiple"; values: unknown[]; distinctValues: unknown[] };
