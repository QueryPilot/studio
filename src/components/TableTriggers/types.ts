import type { TriggerMeta } from "@/services/databaseService";

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
  condition: string;
  _original: TriggerMeta;
}
