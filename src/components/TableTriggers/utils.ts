import type { TriggerMeta } from "@/services/databaseService";
import type { TriggerGridRow } from "./types";
import type {
  CrudCommand,
  TriggerDropPayload,
  TriggerTogglePayload,
  TriggerRenamePayload,
} from "@/types/crud";

export type TriggerModifiedField = "name" | "enabled";

export function getTriggerModifiedFields(
  row: TriggerGridRow,
): Set<TriggerModifiedField> {
  const fields = new Set<TriggerModifiedField>();
  if (row._isPendingDelete) {
    return fields;
  }

  if (row._pendingName !== undefined) {
    fields.add("name");
  }

  if (row._pendingEnabled !== undefined) {
    fields.add("enabled");
  }

  return fields;
}

export function transformTriggersToRows(
  triggers: TriggerMeta[],
  pendingCommands: CrudCommand[] = [],
): TriggerGridRow[] {
  // Extract pending operations by type
  const pendingDeletes = pendingCommands.filter(
    (cmd) => cmd.type === "trigger.drop",
  ) as CrudCommand<TriggerDropPayload>[];

  const pendingEnables = pendingCommands.filter(
    (cmd) => cmd.type === "trigger.enable",
  ) as CrudCommand<TriggerTogglePayload>[];

  const pendingDisables = pendingCommands.filter(
    (cmd) => cmd.type === "trigger.disable",
  ) as CrudCommand<TriggerTogglePayload>[];

  const pendingRenames = pendingCommands.filter(
    (cmd) => cmd.type === "trigger.rename",
  ) as CrudCommand<TriggerRenamePayload>[];

  // Build lookup maps
  const deletedTriggerNames = new Set(
    pendingDeletes.map((cmd) => cmd.payload.triggerName),
  );

  // Map of original name -> new name for renames
  const renameMap = new Map<string, string>(
    pendingRenames.map((cmd) => [cmd.payload.triggerName, cmd.payload.newName]),
  );

  // Map of trigger name -> pending enabled state
  const enabledMap = new Map<string, boolean>();
  for (const cmd of pendingEnables) {
    enabledMap.set(cmd.payload.triggerName, true);
  }
  for (const cmd of pendingDisables) {
    enabledMap.set(cmd.payload.triggerName, false);
  }

  return triggers.map((trigger, idx) => {
    const isPendingDelete = deletedTriggerNames.has(trigger.name);
    const newName = renameMap.get(trigger.name);
    const pendingEnabled = enabledMap.get(trigger.name);
    const hasPendingToggle = pendingEnabled !== undefined;
    const isModified = !!newName || hasPendingToggle;

    // Determine display values
    const displayName = newName ?? trigger.name;
    const displayEnabled = pendingEnabled ?? trigger.enabled;

    return {
      row_number: idx + 1,
      name: displayName,
      event: trigger.event,
      timing: trigger.timing,
      level: trigger.level,
      enabled: displayEnabled ? "YES" : "NO",
      function: trigger.function,
      definition: trigger.condition ?? "",
      _original: trigger,
      _isPendingDelete: isPendingDelete,
      _isPendingToggle: hasPendingToggle,
      _isModified: isModified,
      _pendingEnabled: pendingEnabled,
      _pendingName: newName,
    };
  });
}
