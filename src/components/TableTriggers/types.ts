import type { TriggerMeta } from "@/services/databaseService";

// Grid row format
export interface TriggerGridRow {
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
