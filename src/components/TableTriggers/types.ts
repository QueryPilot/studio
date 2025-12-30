import type { TriggerMeta } from "@/services/databaseService";
import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

// Grid row format - index signature required for TableDataRow compatibility
export interface TriggerGridRow {
  [key: string]: unknown; // Index signature for TableDataRow compatibility
  row_number: number;
  name: string;
  event: string;
  timing: string;
  level: string;
  enabled: string;
  function: string;
  definition: string;
  _original: TriggerMeta;
  // Pending state flags
  _isPending?: boolean;
  _isPendingDelete?: boolean;
  _isPendingToggle?: boolean;
  _isModified?: boolean;
  _pendingEnabled?: boolean; // Pending enable/disable state
  _pendingName?: string; // Pending renamed name
}

// Custom cell type for trigger name with edit capability
export interface TriggerNameCellData {
  readonly kind: "trigger-name-cell";
  readonly name: string;
  readonly isLocked?: boolean;
}

export interface TriggerNameCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: TriggerNameCellData;
  copyData: string;
  readonly?: boolean;
}

// Custom cell type for trigger enabled toggle
export interface TriggerEnabledCellData {
  readonly kind: "trigger-enabled-cell";
  readonly value: "YES" | "NO";
  readonly isLocked?: boolean;
}

export interface TriggerEnabledCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: TriggerEnabledCellData;
  copyData: string;
  readonly?: boolean;
}
