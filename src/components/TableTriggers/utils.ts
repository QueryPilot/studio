import type { TriggerMeta } from "@/services/databaseService";
import type { TriggerGridRow } from "./types";

export function transformTriggersToRows(triggers: TriggerMeta[]): TriggerGridRow[] {
  return triggers.map((trigger, idx) => ({
    row_number: idx + 1,
    name: trigger.name,
    event: trigger.event,
    timing: trigger.timing,
    level: trigger.level,
    enabled: trigger.enabled ? "YES" : "NO",
    function: trigger.function,
    condition: trigger.condition ?? "",
    _original: trigger,
  }));
}
