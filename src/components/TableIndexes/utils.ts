import type { TableIndex } from "@/services/databaseService";
import type { IndexGridRow } from "./types";

export function transformIndexesToRows(indexes: TableIndex[]): IndexGridRow[] {
  return indexes.map((index, idx) => ({
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
}
