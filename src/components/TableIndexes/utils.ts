import type { TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";
import type { IndexGridRow } from "./types";
import type { CrudCommand, IndexCreatePayload } from "@/types/crud";

function formatStatistics(stats?: IndexUsageStats): string {
  if (!stats) return "—";

  const parts: string[] = [];

  // Scan count
  if (stats.scan_count !== undefined) {
    parts.push(`${stats.scan_count.toLocaleString()} scans`);
  }

  // Size
  if (stats.size_pretty) {
    parts.push(stats.size_pretty);
  }

  // Cache hit ratio
  if (stats.cache_hit_ratio !== undefined && stats.cache_hit_ratio > 0) {
    parts.push(`${stats.cache_hit_ratio.toFixed(1)}% cache`);
  }

  // Unused warning
  if (stats.is_unused) {
    parts.push("⚠️ unused");
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function transformIndexesToRows(
  indexes: TableIndex[],
  pendingCommands: CrudCommand[] = [],
  statsMap?: Map<string, IndexUsageStats>,
): IndexGridRow[] {
  // Extract pending operations by type
  const pendingAdds = pendingCommands.filter(
    (cmd) => cmd.type === "index.create",
  ) as CrudCommand<IndexCreatePayload>[];

  const pendingDeletes = pendingCommands.filter(
    (cmd) => cmd.type === "index.drop",
  );

  // Build lookup set for deleted indexes
  const deletedIndexNames = new Set(
    pendingDeletes.map((cmd) => (cmd.payload as { indexName: string }).indexName),
  );

  // Transform actual indexes first
  const actualRows: IndexGridRow[] = indexes.map((index, idx) => {
    const stats = statsMap?.get(index.name);
    const isPendingDelete = deletedIndexNames.has(index.name);

    return {
      row_number: idx + 1,
      name: index.name,
      name_meta: {
        primary: index.primary,
        unique: index.unique,
      },
      columns: index.columns.join(", "),
      index_type: index.index_type,
      unique: index.unique ? "YES" : "NO",
      statistics: formatStatistics(stats),
      stats,
      condition: index.condition || "",
      _original: index,
      _isPendingDelete: isPendingDelete,
    };
  });

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
      statistics: "—",
      condition: def.where ?? "",
      _tempId: cmd.payload.tempId,
      _isPending: true,
    };
  });

  // Merge: actual indexes first, then pending additions at bottom
  return [...actualRows, ...virtualRows];
}
