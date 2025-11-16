import type { TableIndex } from "@/services/databaseService";
import type { IndexGridRow } from "./types";
import type { CrudCommand, IndexCreatePayload } from "@/types/crud";

export function transformIndexesToRows(
  indexes: TableIndex[],
  pendingCommands: CrudCommand[] = [],
): IndexGridRow[] {
  // Extract pending index additions
  const pendingAdds = pendingCommands.filter(
    (cmd) => cmd.type === "index.create",
  ) as CrudCommand<IndexCreatePayload>[];

  // Transform actual indexes first
  const actualRows: IndexGridRow[] = indexes.map((index, idx) => ({
    row_number: idx + 1,
    name: index.name,
    name_meta: {
      primary: index.primary,
      unique: index.unique,
    },
    columns: index.columns.join(", "),
    index_type: index.index_type,
    unique: index.unique ? "YES" : "NO",
    condition: index.condition || "",
    _original: index,
  }));

  // Create virtual rows for pending additions (at bottom)
  const virtualRows: IndexGridRow[] = pendingAdds.map((cmd, idx) => {
    const def = cmd.payload.definition;
    return {
      row_number: actualRows.length + idx + 1,
      name: def.name || "(new index)",
      name_meta: {
        primary: false,
        unique: def.unique ?? false,
      },
      columns: (def.columns || []).join(", "),
      index_type: def.using || "btree",
      unique: def.unique ? "YES" : "NO",
      condition: def.where ?? "",
      _tempId: cmd.payload.tempId,
      _isPending: true,
    };
  });

  // Merge: actual indexes first, then pending additions at bottom
  return [...actualRows, ...virtualRows];
}
