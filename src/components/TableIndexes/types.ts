import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";
import type { TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";

// Grid row format - index signature required for TableDataRow compatibility
export interface IndexGridRow {
  [key: string]: unknown; // Index signature for TableDataRow compatibility
  row_number: number;
  name: string;
  name_meta: {
    primary: boolean;
    unique: boolean;
  };
  columns: string;
  index_type: string;
  unique: string;
  statistics: string;
  stats?: IndexUsageStats;
  condition: string;
  _original?: TableIndex; // Keep reference to original data
  _tempId?: string; // For pending index additions
  _isPending?: boolean; // True for new indexes not yet committed
  _isPendingDelete?: boolean; // True for existing indexes marked for deletion
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
