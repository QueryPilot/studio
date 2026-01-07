/**
 * Optimized SQL Completion Source
 *
 * Performance optimizations:
 * - Request deduplication: Only one in-flight request per context
 * - Result caching with intelligent invalidation
 * - Throttled context analysis
 * - Early returns for unchanged contexts
 * - Fuzzy matching for better discoverability
 * - Usage-based ranking for frequently used items
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { createSqlMetadataProvider } from "./metadataProvider";
import { searchFunctions } from "./functions";
import type { SqlDialect } from "../../types";
import { extractTableRefs, resolveTableAlias } from "./shared";
import { analyzeSqlContext } from "./context";
import { shouldTriggerCompletion } from "./deferred-completion";

interface CompletionConfig {
  connectionId: string;
  database: string;
  schema?: string;
  dialect?: SqlDialect;
}

interface CacheEntry {
  completions: Completion[];
  timestamp: number;
  contextHash: string;
}

// ============================================================================
// USAGE TRACKING - Boost frequently used items
// ============================================================================
const USAGE_STORAGE_KEY = "sql-completion-usage";
const MAX_USAGE_ENTRIES = 500;

interface UsageData {
  tables: Record<string, number>;
  columns: Record<string, number>;
  functions: Record<string, number>;
}

let usageCache: UsageData | null = null;

function getUsageData(): UsageData {
  if (usageCache) return usageCache;

  try {
    const stored = localStorage.getItem(USAGE_STORAGE_KEY);
    if (stored) {
      usageCache = JSON.parse(stored) as UsageData;
      return usageCache;
    }
  } catch {
    // Ignore localStorage errors
  }

  usageCache = { tables: {}, columns: {}, functions: {} };
  return usageCache;
}

function saveUsageData(): void {
  if (!usageCache) return;

  try {
    // Prune old entries if too many
    const prune = (obj: Record<string, number>) => {
      const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
      if (entries.length > MAX_USAGE_ENTRIES) {
        return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES));
      }
      return obj;
    };

    usageCache.tables = prune(usageCache.tables);
    usageCache.columns = prune(usageCache.columns);
    usageCache.functions = prune(usageCache.functions);

    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usageCache));
  } catch {
    // Ignore localStorage errors
  }
}

function recordUsage(type: "tables" | "columns" | "functions", name: string): void {
  const data = getUsageData();
  const key = name.toLowerCase();
  data[type][key] = (data[type][key] || 0) + 1;

  // Debounce save
  if (typeof window !== "undefined") {
    clearTimeout((recordUsage as { timer?: number }).timer);
    (recordUsage as { timer?: number }).timer = window.setTimeout(saveUsageData, 1000);
  }
}

function getUsageBoost(type: "tables" | "columns" | "functions", name: string): number {
  const data = getUsageData();
  const count = data[type][name.toLowerCase()] || 0;
  // Logarithmic scaling: log2(count + 1) capped at 5
  return Math.min(Math.log2(count + 1), 5);
}

// ============================================================================
// FUZZY MATCHING - Better discoverability
// ============================================================================

/**
 * Calculate fuzzy match score between query and target.
 * Supports:
 * - Prefix matching: "ord" -> "orders" (highest)
 * - Underscore split: "oi" -> "order_items"
 * - Camel case: "oI" -> "orderItems"
 * - Substring: "item" -> "order_items"
 * - Acronym: "cui" -> "create_user_index"
 */
function fuzzyScore(query: string, target: string): number {
  if (!query || !target) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (t === q) return 100;

  // Prefix match (highest priority)
  if (t.startsWith(q)) return 90 + (q.length / t.length) * 10;

  // Underscore/camelCase acronym match: "oi" -> "order_items"
  const parts = target.split(/[_\s]|(?=[A-Z])/);
  const acronym = parts.map(p => p[0] || "").join("").toLowerCase();
  if (acronym === q) return 85;
  if (acronym.startsWith(q)) return 80 + (q.length / acronym.length) * 5;

  // Sequential character match with gap penalty
  let score = 0;
  let queryIdx = 0;
  let lastMatchIdx = -1;
  let consecutiveBonus = 0;

  for (let i = 0; i < t.length && queryIdx < q.length; i++) {
    if (t[i] === q[queryIdx]) {
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        consecutiveBonus += 5;
      } else {
        consecutiveBonus = 0;
      }

      // Bonus for matching at word boundaries
      const isWordStart = i === 0 || /[_\s]/.test(t[i - 1] || "") ||
                          (t[i - 1]?.toLowerCase() === t[i - 1] && t[i]?.toUpperCase() === t[i]);

      score += 10 + consecutiveBonus + (isWordStart ? 15 : 0);
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All characters must match
  if (queryIdx !== q.length) return 0;

  // Normalize by target length (prefer shorter matches)
  return Math.min(score * (q.length / t.length), 75);
}

/**
 * Filter and sort completions by fuzzy match score
 */
function filterByFuzzy(
  completions: Completion[],
  query: string,
  minScore: number = 10
): Completion[] {
  if (!query || query.length < 1) return completions;

  const scored = completions
    .map(c => ({ completion: c, score: fuzzyScore(query, c.label) }))
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return scored.map(s => s.completion);
}

// Cache for completion results
const completionCache = new Map<string, CacheEntry>();
const CACHE_TTL = 10000; // 10 seconds
const MAX_CACHE_SIZE = 50;

// In-flight request tracking
const inflightRequests = new Map<string, Promise<Completion[] | null>>();

// ============================================================================
// PREFIX-BASED CACHING - Cache raw metadata for fast incremental filtering
// ============================================================================
interface MetadataCache {
  tables: Completion[];
  columns: Map<string, Completion[]>; // keyed by "table.toLowerCase()"
  timestamp: number;
}

const metadataCache = new Map<string, MetadataCache>();
const METADATA_CACHE_TTL = 30000; // 30 seconds - metadata changes less frequently

function getMetadataCache(connectionId: string): MetadataCache | null {
  const cached = metadataCache.get(connectionId);
  if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
    return cached;
  }
  return null;
}

function setMetadataCache(connectionId: string, cache: MetadataCache): void {
  // Limit total connections cached
  if (metadataCache.size > 10) {
    const oldest = [...metadataCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) metadataCache.delete(oldest[0]);
  }
  metadataCache.set(connectionId, cache);
}

/**
 * Generate a hash for the completion context
 */
function hashContext(
  pos: number,
  docLength: number,
  beforeCursor: string
): string {
  // Use last 100 chars before cursor for context
  const contextSlice = beforeCursor.slice(-100);
  return `${pos}:${docLength}:${contextSlice}`;
}

/**
 * Clean old cache entries
 */
function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of completionCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      completionCache.delete(key);
    }
  }

  // Evict oldest if over size
  if (completionCache.size > MAX_CACHE_SIZE) {
    const entries = [...completionCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    for (let i = 0; i < entries.length - MAX_CACHE_SIZE; i++) {
      const entry = entries[i];
      if (entry) {
        completionCache.delete(entry[0]);
      }
    }
  }
}

/**
 * Quick context analysis - lightweight version for early filtering
 * Uses smart triggering to avoid completing on every keystroke
 */
function quickAnalyze(
  context: CompletionContext
): { shouldComplete: boolean; intent: "table" | "column" | "unknown" } {
  const { state, pos } = context;

  // Check for word being typed
  const word = context.matchBefore(/[\w_]+/);
  const afterDot = context.matchBefore(/\.\s*[\w_]*$/);

  // Always complete after dot
  if (afterDot) {
    return { shouldComplete: true, intent: "column" };
  }

  // Check if explicit trigger (Ctrl+Space)
  if (context.explicit) {
    return { shouldComplete: true, intent: "unknown" };
  }

  // Get context for smart triggering
  const line = state.doc.lineAt(pos);
  const beforeCursor = line.text.slice(0, pos - line.from);

  // Detect last typed character for smart triggering
  const lastChar = beforeCursor.slice(-1);

  // Use smart trigger check - only complete on meaningful characters
  if (!shouldTriggerCompletion(lastChar, beforeCursor.slice(0, -1), false)) {
    // Not a trigger character - require at least 2 chars of identifier
    if (!word || word.text.length < 2) {
      return { shouldComplete: false, intent: "unknown" };
    }
  }

  // Check context for table vs column
  const beforeCursorUpper = beforeCursor.toUpperCase();
  const tableKeywords = ["FROM ", "JOIN ", "INTO ", "UPDATE ", "TABLE "];
  const isTableContext = tableKeywords.some((kw) =>
    beforeCursorUpper.trimEnd().endsWith(kw.trimEnd())
  );

  return {
    shouldComplete: true,
    intent: isTableContext ? "table" : "column",
  };
}

/**
 * Create optimized completion source
 */
export function createOptimizedCompletionSource(config: CompletionConfig) {
  const { connectionId, schema, dialect = "postgresql" } = config;
  const defaultSchema = schema || "public";
  const provider = createSqlMetadataProvider(connectionId, defaultSchema);

  return async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    // Quick analysis for early return
    const analysis = quickAnalyze(context);
    if (!analysis.shouldComplete) {
      return null;
    }

    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const beforeCursor = line.text.slice(0, pos - line.from);
    const contextHash = hashContext(pos, state.doc.length, beforeCursor);

    // Check cache
    const cacheKey = `${connectionId}:${contextHash}`;
    const cached = completionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const word = context.matchBefore(/[\w_]+/);
      return {
        from: word?.from ?? pos,
        options: cached.completions,
        validFor: /^[\w_]*$/,
      };
    }

    // Check for in-flight request
    const inflightKey = `${connectionId}:${analysis.intent}`;
    const inflight = inflightRequests.get(inflightKey);
    if (inflight) {
      try {
        const results = await inflight;
        if (results) {
          const word = context.matchBefore(/[\w_]+/);
          return {
            from: word?.from ?? pos,
            options: results,
            validFor: /^[\w_]*$/,
          };
        }
      } catch {
        // Ignore - will retry
      }
    }

    // Create new request
    const requestPromise = fetchCompletions(
      provider,
      context,
      analysis.intent,
      defaultSchema,
      dialect,
      connectionId
    );

    inflightRequests.set(inflightKey, requestPromise);

    try {
      const completions = await requestPromise;
      inflightRequests.delete(inflightKey);

      if (!completions || completions.length === 0) {
        return null;
      }

      // Cache results
      cleanCache();
      completionCache.set(cacheKey, {
        completions,
        timestamp: Date.now(),
        contextHash,
      });

      const word = context.matchBefore(/[\w_]+/);
      return {
        from: word?.from ?? pos,
        options: completions,
        validFor: /^[\w_]*$/,
      };
    } catch {
      inflightRequests.delete(inflightKey);
      return null;
    }
  };
}

/**
 * Fetch completions from provider with fuzzy matching and usage-based ranking
 * Uses metadata cache for fast incremental filtering
 */
async function fetchCompletions(
  provider: ReturnType<typeof createSqlMetadataProvider>,
  context: CompletionContext,
  intent: "table" | "column" | "unknown",
  defaultSchema: string,
  dialect: SqlDialect,
  connectionId: string
): Promise<Completion[] | null> {
  const completions: Completion[] = [];
  const word = context.matchBefore(/[\w_]+/);
  const query = word?.text || "";

  try {
    // Check for JOIN ON context - suggest FK relationships
    const sqlContext = analyzeSqlContext(context);
    if (sqlContext.isJoinOnContext && sqlContext.joinTargetTable && provider.getJoinConditions) {
      const tablesInScope = sqlContext.activeStatementTables
        .filter(t => t.name.toLowerCase() !== sqlContext.joinTargetTable?.name.toLowerCase())
        .map(t => ({ name: t.name, alias: t.alias, schema: t.schema }));

      if (tablesInScope.length > 0) {
        const joinConditions = await provider.getJoinConditions(
          tablesInScope,
          {
            name: sqlContext.joinTargetTable.name,
            alias: sqlContext.joinTargetTable.alias,
            schema: sqlContext.joinTargetTable.schema,
          },
          defaultSchema
        );

        for (const suggestion of joinConditions) {
          completions.push({
            label: suggestion.condition,
            type: suggestion.source === "fk" ? "method" : "text",
            detail: suggestion.description,
            boost: suggestion.score + (suggestion.source === "fk" ? 20 : 10),
            apply: suggestion.condition,
          });
        }

        if (completions.length > 0) {
          return query ? filterByFuzzy(completions, query) : completions;
        }
      }
    }

    // Check for qualified access (e.g., table.column or alias.column)
    const dotMatch = context.matchBefore(/([a-zA-Z0-9_"`[\]]+)\.\s*[\w_]*$/);

    if (dotMatch) {
      // Qualified column access - need to resolve alias to table name
      const qualifier = dotMatch.text.split(".")[0]?.replace(/["`[\]]/g, "");
      if (qualifier) {
        // Extract table refs to resolve aliases (using connectionId for instance-scoped caching)
        const tables = extractTableRefs(context.state, connectionId);
        const resolved = resolveTableAlias(qualifier, tables);
        const cacheKey = resolved.tableName.toLowerCase();

        // Check if this is a CTE with defined columns
        const cteRef = tables.find(t =>
          t.isCTE && (t.name.toLowerCase() === qualifier.toLowerCase() || t.alias?.toLowerCase() === qualifier.toLowerCase())
        );

        if (cteRef?.cteColumns && cteRef.cteColumns.length > 0) {
          // CTE with explicit columns - suggest them directly
          for (const colName of cteRef.cteColumns) {
            completions.push({
              label: colName,
              type: "property",
              detail: "CTE column",
              boost: 12, // Higher than regular columns
              apply: quoteIdentifier(colName, dialect),
            });
          }
          const columnQuery = dotMatch.text.split(".")[1]?.replace(/["`[\]]/g, "") || "";
          return columnQuery ? filterByFuzzy(completions, columnQuery) : completions;
        }

        if (cteRef?.cteSourceTable) {
          // CTE with SELECT * - fetch columns from source table
          const sourceFields = await provider.listFields(cteRef.cteSourceTable, defaultSchema);
          for (const field of sourceFields) {
            completions.push({
              label: field.name,
              type: "property",
              detail: `${field.dataType} (from ${cteRef.cteSourceTable})`,
              boost: 12,
              apply: quoteIdentifier(field.name, dialect),
            });
          }
          if (completions.length > 0) {
            const columnQuery = dotMatch.text.split(".")[1]?.replace(/["`[\]]/g, "") || "";
            return columnQuery ? filterByFuzzy(completions, columnQuery) : completions;
          }
        }

        // Try metadata cache first for instant response
        const cached = getMetadataCache(connectionId);
        if (cached?.columns.has(cacheKey)) {
          const cachedColumns = cached.columns.get(cacheKey)!;
          const columnQuery = dotMatch.text.split(".")[1]?.replace(/["`[\]]/g, "") || "";
          return columnQuery ? filterByFuzzy(cachedColumns, columnQuery) : cachedColumns;
        }

        // Fetch fields using the resolved table name
        const fields = await provider.listFields(resolved.tableName, resolved.schema || defaultSchema);

        // If no fields found with resolved name, try qualifier as schema
        if (fields.length === 0) {
          const entities = await provider.listEntities(qualifier);
          if (entities.length > 0) {
            for (const entity of entities) {
              const usageBoost = getUsageBoost("tables", entity.name);
              completions.push({
                label: entity.name,
                type: entity.type === "table" ? "class" : "constant",
                detail: entity.type,
                boost: 5 + usageBoost,
                apply: quoteIdentifier(entity.name, dialect),
              });
            }
            const columnQuery = dotMatch.text.split(".")[1]?.replace(/["`[\]]/g, "") || "";
            if (columnQuery) {
              return filterByFuzzy(completions, columnQuery);
            }
            return completions;
          }
        }

        for (const field of fields) {
          const usageBoost = getUsageBoost("columns", field.name);
          completions.push({
            label: field.name,
            type: "property",
            detail: field.dataType,
            info: field.description,
            boost: 10 + usageBoost,
            apply: quoteIdentifier(field.name, dialect),
          });
        }

        // Cache column completions for this table
        if (completions.length > 0) {
          const existingCache = getMetadataCache(connectionId) || {
            tables: [],
            columns: new Map(),
            timestamp: Date.now(),
          };
          existingCache.columns.set(cacheKey, [...completions]);
          setMetadataCache(connectionId, existingCache);
        }
      }

      // Apply fuzzy filtering for qualified access
      const columnQuery = dotMatch.text.split(".")[1]?.replace(/["`[\]]/g, "") || "";
      if (columnQuery) {
        return filterByFuzzy(completions, columnQuery);
      }
      return completions;
    }

    if (intent === "table") {
      // Try metadata cache first for instant response
      const cached = getMetadataCache(connectionId);
      if (cached?.tables.length) {
        return query ? filterByFuzzy(cached.tables, query) : cached.tables;
      }

      // Table context - fetch and cache
      const entities = await provider.listEntities();
      for (const entity of entities) {
        const alias = generateAlias(entity.name);
        const usageBoost = getUsageBoost("tables", entity.name);
        completions.push({
          label: entity.name,
          type: entity.type === "table" ? "class" : "constant",
          detail: alias ? `→ ${alias}` : entity.type,
          boost: 5 + usageBoost,
          apply: `${quoteIdentifier(entity.name, dialect)}${alias ? ` ${alias}` : ""}`,
        });
      }

      // Cache table completions
      if (completions.length > 0) {
        const existingCache = getMetadataCache(connectionId) || {
          tables: [],
          columns: new Map(),
          timestamp: Date.now(),
        };
        existingCache.tables = [...completions];
        existingCache.timestamp = Date.now();
        setMetadataCache(connectionId, existingCache);
      }

      // Apply fuzzy filtering
      if (query) {
        return filterByFuzzy(completions, query);
      }
      return completions;
    }

    // General context - fetch tables and functions
    const entities = await provider.listEntities();

    // Extract table refs to show aliases with higher priority
    const tables = extractTableRefs(context.state, connectionId);

    // Add table aliases for quick qualified access (highest priority in column context)
    // Filter out the current word being typed to avoid self-suggestion
    const queryLower = query.toLowerCase();
    for (const table of tables) {
      const aliasOrName = table.alias || table.name;

      // Skip if this is exactly what the user is typing (self-suggestion bug)
      if (aliasOrName.toLowerCase() === queryLower) continue;

      const usageBoost = getUsageBoost("tables", table.name);
      completions.push({
        label: aliasOrName,
        type: "class",
        detail: table.alias ? `alias → ${table.name}` : "table",
        boost: 8 + usageBoost, // Higher than regular tables
        apply: `${aliasOrName}.`, // Add dot for immediate column access
      });
    }

    // Add tables (without auto-appending dot - user can type it for column access)
    for (const entity of entities) {
      if (entity.type === "table") {
        // Skip if already added as an alias
        const alreadyAdded = tables.some(
          t => t.name.toLowerCase() === entity.name.toLowerCase() ||
               t.alias?.toLowerCase() === entity.name.toLowerCase()
        );
        if (alreadyAdded) continue;

        const usageBoost = getUsageBoost("tables", entity.name);
        completions.push({
          label: entity.name,
          type: "class",
          detail: "table",
          boost: 3 + usageBoost,
        });
      }
    }

    // Add SQL functions (with fuzzy matching built-in from searchFunctions)
    if (query.length >= 2) {
      const funcs = searchFunctions(query);
      for (const fn of funcs.slice(0, 20)) {
        const usageBoost = getUsageBoost("functions", fn.name);
        completions.push({
          label: fn.name,
          type: "function",
          detail: fn.signature,
          info: fn.description,
          boost: 2 + usageBoost,
          apply: fn.parameters.length === 0 ? `${fn.name}()` : `${fn.name}(`,
        });
      }
    }

    // Apply fuzzy filtering to all completions
    if (query) {
      return filterByFuzzy(completions, query);
    }
    return completions;
  } catch {
    return null;
  }
}

/**
 * Quote identifier for dialect
 */
function quoteIdentifier(name: string, dialect: SqlDialect): string {
  switch (dialect) {
    case "mysql":
      return `\`${name}\``;
    case "mssql":
      return `[${name}]`;
    default:
      return `"${name}"`;
  }
}

/**
 * Generate smart alias for table
 */
function generateAlias(tableName: string): string {
  if (tableName.includes("_")) {
    return tableName
      .split("_")
      .map((p) => p[0] || "")
      .join("")
      .toLowerCase();
  }
  return tableName[0]?.toLowerCase() || "";
}

/**
 * Clear completion cache
 */
export function clearCompletionCache(connectionId?: string): void {
  if (connectionId) {
    for (const key of completionCache.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        completionCache.delete(key);
      }
    }
  } else {
    completionCache.clear();
  }
  inflightRequests.clear();
}

/**
 * Record usage of a completion item for ranking boost.
 * Call this when user accepts a completion.
 */
export function recordCompletionUsage(
  type: "table" | "column" | "function",
  name: string
): void {
  const typeMap = {
    table: "tables" as const,
    column: "columns" as const,
    function: "functions" as const,
  };
  recordUsage(typeMap[type], name);
}

/**
 * Get fuzzy match score for testing/debugging
 */
export { fuzzyScore };
