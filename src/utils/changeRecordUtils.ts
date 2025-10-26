/**
 * Change Record Utilities
 *
 * Factory functions and utilities for managing change records in the editing store.
 */

// ============================================================================
// Types
// ============================================================================

export type ChangeKind = "insert" | "update" | "delete" | "toggle";
export type DomainKind =
  | "structure"
  | "data"
  | "indexes"
  | "triggers"
  | "constraints";

export interface ChangeRecord<TDraft = any, TOriginal = any> {
  id: string;
  domain: DomainKind;
  kind: ChangeKind;
  draft: TDraft | null;
  original: TOriginal | null;
  diffKeys: string[];
  sqlPreview?: {
    sql: string;
    generatedAt: number;
    warnings?: string[];
  };
  touchedAt: number;
}

// ============================================================================
// ID Generation
// ============================================================================

let changeIdCounter = 0;
const changeIdPrefix = "chg";

/**
 * Generate unique ID for change record
 */
export function createChangeId(): string {
  const timestamp = Date.now();
  const counter = ++changeIdCounter;
  const random = Math.random().toString(36).substring(2, 7);

  return `${changeIdPrefix}_${timestamp}_${counter}_${random}`;
}

/**
 * Reset change ID counter (useful for testing)
 */
export function resetChangeIdCounter(): void {
  changeIdCounter = 0;
}

// ============================================================================
// Change Record Factory
// ============================================================================

export interface CreateChangeRecordParams<TDraft = any, TOriginal = any> {
  domain: DomainKind;
  kind: ChangeKind;
  draft: TDraft | null;
  original: TOriginal | null;
  diffKeys?: string[];
  id?: string;
  touchedAt?: number;
}

/**
 * Create a new change record
 */
export function createChangeRecord<TDraft = any, TOriginal = any>(
  params: CreateChangeRecordParams<TDraft, TOriginal>,
): ChangeRecord<TDraft, TOriginal> {
  return {
    id: params.id || createChangeId(),
    domain: params.domain,
    kind: params.kind,
    draft: params.draft,
    original: params.original,
    diffKeys: params.diffKeys || [],
    touchedAt: params.touchedAt || Date.now(),
  };
}

// ============================================================================
// Clone Operations
// ============================================================================

/**
 * Deep clone a change record (for undo/redo)
 */
export function cloneChangeRecord<TDraft = any, TOriginal = any>(
  record: ChangeRecord<TDraft, TOriginal>,
): ChangeRecord<TDraft, TOriginal> {
  return {
    ...record,
    draft: record.draft ? structuredClone(record.draft) : null,
    original: record.original ? structuredClone(record.original) : null,
    diffKeys: [...record.diffKeys],
    sqlPreview: record.sqlPreview
      ? {
          ...record.sqlPreview,
          warnings: record.sqlPreview.warnings
            ? [...record.sqlPreview.warnings]
            : undefined,
        }
      : undefined,
  };
}

/**
 * Clone Map of change records
 */
export function cloneChangeRecordMap<TDraft = any, TOriginal = any>(
  map: Map<string, ChangeRecord<TDraft, TOriginal>>,
): Map<string, ChangeRecord<TDraft, TOriginal>> {
  const cloned = new Map<string, ChangeRecord<TDraft, TOriginal>>();

  for (const [key, record] of map) {
    cloned.set(key, cloneChangeRecord(record));
  }

  return cloned;
}

// ============================================================================
// Merge Operations
// ============================================================================

export interface MergeOptions {
  preferNewer?: boolean; // When conflicting, prefer newer touchedAt
  mergeDiffKeys?: boolean; // Merge diffKeys arrays
}

/**
 * Merge two change records (for consolidating multiple edits to same entity)
 */
export function mergeChangeRecords<TDraft = any, TOriginal = any>(
  existing: ChangeRecord<TDraft, TOriginal>,
  incoming: ChangeRecord<TDraft, TOriginal>,
  options: MergeOptions = {},
): ChangeRecord<TDraft, TOriginal> {
  const { preferNewer = true, mergeDiffKeys = true } = options;

  // Determine which record to use as base
  const base =
    preferNewer && incoming.touchedAt > existing.touchedAt
      ? incoming
      : existing;

  // Merge diffKeys
  const diffKeys = mergeDiffKeys
    ? Array.from(new Set([...existing.diffKeys, ...incoming.diffKeys]))
    : base.diffKeys;

  return {
    ...base,
    diffKeys,
    // Keep original from existing, draft from incoming
    original: existing.original,
    draft: incoming.draft,
    touchedAt: Math.max(existing.touchedAt, incoming.touchedAt),
  };
}

/**
 * Merge multiple change records into one
 */
export function mergeChanges<TDraft = any, TOriginal = any>(
  changes: ChangeRecord<TDraft, TOriginal>[],
  options: MergeOptions = {},
): ChangeRecord<TDraft, TOriginal> | null {
  if (changes.length === 0) return null;
  if (changes.length === 1) return changes[0];

  let merged = changes[0];

  for (let i = 1; i < changes.length; i++) {
    merged = mergeChangeRecords(merged, changes[i], options);
  }

  return merged;
}

// ============================================================================
// SQL Preview Management
// ============================================================================

export interface SqlPreviewOptions {
  sql: string;
  warnings?: string[];
}

/**
 * Attach SQL preview to change record
 */
export function attachSqlPreview<TDraft = any, TOriginal = any>(
  record: ChangeRecord<TDraft, TOriginal>,
  preview: SqlPreviewOptions,
): ChangeRecord<TDraft, TOriginal> {
  return {
    ...record,
    sqlPreview: {
      sql: preview.sql,
      generatedAt: Date.now(),
      warnings: preview.warnings,
    },
  };
}

/**
 * Check if SQL preview is stale (older than TTL)
 */
export function isSqlPreviewStale(
  record: ChangeRecord,
  ttlMs: number = 5 * 60 * 1000, // 5 minutes default
): boolean {
  if (!record.sqlPreview) return true;

  const age = Date.now() - record.sqlPreview.generatedAt;
  return age > ttlMs;
}

/**
 * Clear SQL preview from change record
 */
export function clearSqlPreview<TDraft = any, TOriginal = any>(
  record: ChangeRecord<TDraft, TOriginal>,
): ChangeRecord<TDraft, TOriginal> {
  const { sqlPreview, ...rest } = record;
  return rest as ChangeRecord<TDraft, TOriginal>;
}

// ============================================================================
// Filtering & Querying
// ============================================================================

/**
 * Filter change records by domain
 */
export function filterByDomain(
  records: ChangeRecord[],
  domain: DomainKind,
): ChangeRecord[] {
  return records.filter((r) => r.domain === domain);
}

/**
 * Filter change records by kind
 */
export function filterByKind(
  records: ChangeRecord[],
  kind: ChangeKind,
): ChangeRecord[] {
  return records.filter((r) => r.kind === kind);
}

/**
 * Filter change records by multiple criteria
 */
export function filterChangeRecords(
  records: ChangeRecord[],
  criteria: {
    domain?: DomainKind;
    kind?: ChangeKind;
    minTouchedAt?: number;
    maxTouchedAt?: number;
  },
): ChangeRecord[] {
  return records.filter((record) => {
    if (criteria.domain && record.domain !== criteria.domain) return false;
    if (criteria.kind && record.kind !== criteria.kind) return false;
    if (criteria.minTouchedAt && record.touchedAt < criteria.minTouchedAt)
      return false;
    if (criteria.maxTouchedAt && record.touchedAt > criteria.maxTouchedAt)
      return false;
    return true;
  });
}

/**
 * Sort change records by touched timestamp
 */
export function sortByTouchedAt(
  records: ChangeRecord[],
  descending: boolean = false,
): ChangeRecord[] {
  return [...records].sort((a, b) => {
    const diff = a.touchedAt - b.touchedAt;
    return descending ? -diff : diff;
  });
}

/**
 * Group change records by domain
 */
export function groupByDomain(
  records: ChangeRecord[],
): Map<DomainKind, ChangeRecord[]> {
  const groups = new Map<DomainKind, ChangeRecord[]>();

  for (const record of records) {
    const group = groups.get(record.domain) || [];
    group.push(record);
    groups.set(record.domain, group);
  }

  return groups;
}

/**
 * Group change records by kind
 */
export function groupByKind(
  records: ChangeRecord[],
): Map<ChangeKind, ChangeRecord[]> {
  const groups = new Map<ChangeKind, ChangeRecord[]>();

  for (const record of records) {
    const group = groups.get(record.kind) || [];
    group.push(record);
    groups.set(record.kind, group);
  }

  return groups;
}

// ============================================================================
// Validation & Analysis
// ============================================================================

/**
 * Check if change record is destructive (requires confirmation)
 */
export function isDestructiveChange(record: ChangeRecord): boolean {
  // DELETE operations are always destructive
  if (record.kind === "delete") return true;

  // Structure domain: dropping columns or changing types can be destructive
  if (record.domain === "structure") {
    if (record.kind === "delete") return true;
    if (record.diffKeys.includes("db_type")) return true;
  }

  // Index domain: dropping unique indexes can be destructive
  if (record.domain === "indexes" && record.kind === "delete") {
    return true;
  }

  // Trigger domain: dropping triggers can be destructive
  if (record.domain === "triggers" && record.kind === "delete") {
    return true;
  }

  return false;
}

/**
 * Get warning messages for a change record
 */
export function getChangeWarnings(record: ChangeRecord): string[] {
  const warnings: string[] = [];

  if (isDestructiveChange(record)) {
    warnings.push("This operation is destructive and cannot be undone");
  }

  if (record.domain === "structure" && record.diffKeys.includes("db_type")) {
    warnings.push("Changing column type may result in data loss");
  }

  if (record.domain === "structure" && record.kind === "delete") {
    warnings.push("All data in this column will be permanently deleted");
  }

  if (record.domain === "indexes" && record.kind === "delete") {
    warnings.push("Queries relying on this index may become slower");
  }

  return warnings;
}

/**
 * Count change records by type
 */
export function countChangesByType(records: ChangeRecord[]): {
  inserts: number;
  updates: number;
  deletes: number;
  toggles: number;
  total: number;
} {
  const counts = {
    inserts: 0,
    updates: 0,
    deletes: 0,
    toggles: 0,
    total: records.length,
  };

  for (const record of records) {
    switch (record.kind) {
      case "insert":
        counts.inserts++;
        break;
      case "update":
        counts.updates++;
        break;
      case "delete":
        counts.deletes++;
        break;
      case "toggle":
        counts.toggles++;
        break;
    }
  }

  return counts;
}

// ============================================================================
// Hash Generation (for cache keys)
// ============================================================================

/**
 * Generate hash from diffKeys for cache key
 */
export function hashDiffKeys(diffKeys: string[]): string {
  if (diffKeys.length === 0) return "empty";

  // Sort keys for consistent hashing
  const sorted = [...diffKeys].sort();
  const str = sorted.join(",");

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(36);
}

/**
 * Generate cache key for change record
 */
export function generateCacheKey(
  record: ChangeRecord,
  prefix: string = "sql",
): string {
  const diffHash = hashDiffKeys(record.diffKeys);
  return `${prefix}_${record.domain}_${record.id}_${diffHash}`;
}
