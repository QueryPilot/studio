import {
  CompactSelection,
  type GridSelection,
} from "@glideapps/glide-data-grid";
import type {
  SerializedGridSelection,
  SerializedSelectionRange,
} from "../types";

const buildRangesFromArray = (values: number[]): SerializedSelectionRange[] => {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const ranges: SerializedSelectionRange[] = [];
  let start = sorted[0];
  let prev = start;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push({ start, end: prev + 1 });
    start = current;
    prev = current;
  }
  ranges.push({ start, end: prev + 1 });
  return ranges;
};

const buildCompactSelection = (
  ranges: SerializedSelectionRange[] | undefined,
): CompactSelection => {
  if (!ranges || ranges.length === 0) {
    return CompactSelection.empty();
  }
  return ranges.reduce(
    (selection, range) => selection.add([range.start, range.end]),
    CompactSelection.empty(),
  );
};

export const serializeGridSelection = (
  selection: GridSelection | undefined,
): SerializedGridSelection | undefined => {
  if (!selection) return undefined;
  const rowsArray = selection.rows ? Array.from(selection.rows) : [];
  const columnsArray = selection.columns ? Array.from(selection.columns) : [];
  return {
    rows: buildRangesFromArray(rowsArray),
    columns: buildRangesFromArray(columnsArray),
    current: selection.current
      ? {
          cell: selection.current.cell,
          range: selection.current.range,
          rangeStack: selection.current.rangeStack ?? [],
        }
      : undefined,
    columnSelect: selection.columnSelect,
    rowSelect: selection.rowSelect,
  } satisfies SerializedGridSelection;
};

export const deserializeGridSelection = (
  serialized: SerializedGridSelection | undefined,
): GridSelection | undefined => {
  if (!serialized) return undefined;
  return {
    rows: buildCompactSelection(serialized.rows),
    columns: buildCompactSelection(serialized.columns),
    current: serialized.current
      ? {
          cell: serialized.current.cell,
          range: serialized.current.range,
          rangeStack: serialized.current.rangeStack ?? [],
        }
      : undefined,
    columnSelect: serialized.columnSelect,
    rowSelect: serialized.rowSelect,
  } satisfies GridSelection;
};
