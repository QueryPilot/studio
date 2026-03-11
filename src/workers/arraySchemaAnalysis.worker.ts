/**
 * Web Worker for analyzing array item schemas.
 * Determines whether an array of items should display as a table
 * (homogeneous objects) or typed-value list (mixed types).
 */

export interface ArraySchemaRequest {
  id: number;
  items: unknown[];
}

export type ArrayLayoutMode = 'table' | 'typed-value';

export interface ArraySchemaResponse {
  id: number;
  mode: ArrayLayoutMode;
  /** All unique field names across objects (table mode) or empty (typed-value) */
  columns: string[];
}

const SCHEMA_OVERLAP_THRESHOLD = 0.8;
const MIN_TABLE_COLUMNS = 2;

/**
 * Analyze array items and determine display mode.
 * Exported for reuse in sync path on main thread.
 */
export function analyzeArraySchema(items: unknown[]): { mode: ArrayLayoutMode; columns: string[] } {
  if (items.length === 0) {
    return { mode: 'typed-value', columns: [] };
  }

  // Check if all items are plain objects (not arrays, not null, not primitives)
  const allObjects = items.every(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  );

  if (!allObjects) {
    return { mode: 'typed-value', columns: [] };
  }

  // Count field frequencies across all objects
  const fieldCounts = new Map<string, number>();
  const totalItems = items.length;

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    }
  }

  // Check how many fields pass the threshold
  const threshold = totalItems * SCHEMA_OVERLAP_THRESHOLD;
  let passingFields = 0;
  for (const count of fieldCounts.values()) {
    if (count >= threshold) {
      passingFields++;
    }
  }

  // Need at least MIN_TABLE_COLUMNS fields passing threshold to use table mode
  if (passingFields < MIN_TABLE_COLUMNS) {
    return { mode: 'typed-value', columns: [] };
  }

  // Table mode: return ALL unique fields (sorted: high-frequency first, then alphabetical)
  const columns = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  return { mode: 'table', columns };
}

self.onmessage = (event: MessageEvent<ArraySchemaRequest>) => {
  const { id, items } = event.data;
  const result = analyzeArraySchema(items);
  const response: ArraySchemaResponse = { id, ...result };
  self.postMessage(response);
};
