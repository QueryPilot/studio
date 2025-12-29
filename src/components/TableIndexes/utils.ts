import type { TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";
import type { IndexGridRow } from "./types";
import type {
  CrudCommand,
  IndexCreatePayload,
  IndexDropPayload,
  IndexRenamePayload,
} from "@/types/crud";

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
  ) as CrudCommand<IndexDropPayload>[];

  const pendingRenames = pendingCommands.filter(
    (cmd) => cmd.type === "index.rename",
  ) as CrudCommand<IndexRenamePayload>[];

  // Build lookup maps for pending operations
  const deletedIndexNames = new Set(
    pendingDeletes.map((cmd) => cmd.payload.indexName),
  );

  // Map of original name -> new name for renames
  const renameMap = new Map<string, string>(
    pendingRenames.map((cmd) => [cmd.payload.indexName, cmd.payload.newName]),
  );

  // Detect recreate pairs: drop + create commands linked via tags like "recreate:indexName"
  // A recreate pair means the drop is part of a structural change, not a simple deletion
  const recreateIndexNames = new Set<string>();

  // Build a set of recreate tags from drop commands
  const dropRecreateTagsToIndexName = new Map<string, string>();
  for (const dropCmd of pendingDeletes) {
    const tags = dropCmd.metadata.tags ?? [];
    for (const tag of tags) {
      if (tag.startsWith("recreate:")) {
        const indexName = tag.slice("recreate:".length);
        dropRecreateTagsToIndexName.set(tag, dropCmd.payload.indexName);
        // If there's a matching create command with the same tag, mark as recreate
        const hasMatchingCreate = pendingAdds.some((createCmd) =>
          createCmd.metadata.tags?.includes(tag),
        );
        if (hasMatchingCreate) {
          recreateIndexNames.add(indexName);
        }
      }
    }
  }

  // Filter out creates that are part of recreate pairs (they modify existing, not add new)
  const pureAdditions = pendingAdds.filter((cmd) => {
    const tags = cmd.metadata.tags ?? [];
    // If this create has a recreate tag, it's not a pure addition
    return !tags.some((tag) => tag.startsWith("recreate:"));
  });

  // Map of original index name -> recreate create command (for applying modifications)
  const recreateCreateMap = new Map<string, CrudCommand<IndexCreatePayload>>();
  for (const createCmd of pendingAdds) {
    const tags = createCmd.metadata.tags ?? [];
    for (const tag of tags) {
      if (tag.startsWith("recreate:")) {
        const indexName = tag.slice("recreate:".length);
        recreateCreateMap.set(indexName, createCmd);
      }
    }
  }

  // Transform actual indexes first
  const actualRows: IndexGridRow[] = indexes.map((index, idx) => {
    const stats = statsMap?.get(index.name);
    const isPendingDelete = deletedIndexNames.has(index.name);
    const isRecreate = recreateIndexNames.has(index.name);
    const newName = renameMap.get(index.name);
    const recreateCmd = recreateCreateMap.get(index.name);

    // Determine display values - if recreating, show the new definition
    let displayName = newName ?? index.name;
    let displayColumns = index.columns;
    let displayIndexType = index.index_type;
    let displayUnique = index.unique;
    let displayCondition = index.condition || "";
    let isModified = !!newName; // Renamed counts as modified

    if (recreateCmd) {
      const def = recreateCmd.payload.definition;
      displayName = def.name;
      displayColumns = def.columns;
      displayIndexType = def.using || "btree";
      displayUnique = def.unique ?? false;
      displayCondition = def.where ?? "";
      isModified = true;
    }

    return {
      row_number: idx + 1,
      name: displayName,
      name_meta: {
        primary: index.primary,
        unique: displayUnique,
      },
      columns: displayColumns.join(", "),
      columns_array: displayColumns,
      index_type: displayIndexType,
      unique: displayUnique ? "YES" : "NO",
      statistics: formatStatistics(stats),
      stats,
      condition: displayCondition,
      _original: index,
      // Only mark as pending delete if it's a standalone delete, not part of recreate
      _isPendingDelete: isPendingDelete && !isRecreate,
      _isModified: isModified,
      _requiresRecreate: isRecreate,
    };
  });

  // Create virtual rows for pure pending additions (at bottom)
  const virtualRows: IndexGridRow[] = pureAdditions.map((cmd, idx) => {
    const def = cmd.payload.definition;
    return {
      row_number: actualRows.length + idx + 1,
      name: def.name || "(new index)",
      name_meta: {
        primary: false,
        unique: def.unique ?? false,
      },
      columns: def.columns.join(", "),
      columns_array: def.columns,
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
