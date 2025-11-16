import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";
import type { TableIndex } from "@/services/databaseService";

// Grid row format
export interface IndexGridRow {
  row_number: number;
  name: string;
  name_meta: {
    primary: boolean;
    unique: boolean;
  };
  columns: string;
  index_type: string;
  unique: string;
  condition: string;
  _original?: TableIndex; // Keep reference to original data
  _tempId?: string; // For pending index additions
  _isPending?: boolean; // True for new indexes not yet committed
}

interface IndexNameCellData {
  kind: "index-name-cell";
  name: string;
  isPrimary: boolean;
  isUnique: boolean;
}

// Custom cell for index name with badges
export interface IndexNameCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: IndexNameCellData;
  copyData: string;
  readonly?: boolean;
}
