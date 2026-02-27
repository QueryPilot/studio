import type { GridColumnV2, GridRowModel } from "../../types";

export type InspectorTab = "tree" | "diff" | "raw";

export interface InspectorPanelProps {
  selectedRows: GridRowModel[];
  columns: GridColumnV2[];
  onCellEdit?: (rowIndexes: number[], field: string, value: unknown) => void;
  className?: string;
  defaultTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
}

export interface InspectorDocument {
  [key: string]: unknown;
}

/** Merged field value for multi-record tree view */
export type MergedFieldValue =
  | { kind: "same"; value: unknown }
  | { kind: "multiple"; values: unknown[]; distinctValues: unknown[] };
