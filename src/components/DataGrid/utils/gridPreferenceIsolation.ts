import type { GridPreferences } from "../stores";

export interface IsolatedGridPreferenceSnapshot {
  columns: GridPreferences["columns"];
  pinnedRows: GridPreferences["pinnedRows"];
  sortColumns: GridPreferences["sortColumns"];
  quickFilter: GridPreferences["quickFilter"];
  structureSearch: GridPreferences["structureSearch"];
}

/**
 * Builds a deep-cloned snapshot of grid preferences that should diverge when
 * sync is disabled. This avoids accidental shared references between keys.
 */
export function buildIsolatedGridPreferenceSnapshot(
  source: GridPreferences | undefined,
): IsolatedGridPreferenceSnapshot | null {
  if (!source) return null;

  return {
    columns: {
      order: [...source.columns.order],
      widths: { ...source.columns.widths },
      visibility: { ...source.columns.visibility },
      pinned: [...source.columns.pinned],
    },
    pinnedRows: [...source.pinnedRows],
    sortColumns: source.sortColumns.map((item) => ({ ...item })),
    quickFilter: source.quickFilter ? { ...source.quickFilter } : undefined,
    structureSearch: source.structureSearch,
  };
}
