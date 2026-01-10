/**
 * Refactor Service
 *
 * Frontend Tauri wrapper for SQL refactoring commands.
 * Provides outline parsing with caching to avoid redundant backend calls.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";

// Types matching Rust structs from outline.rs
// (serde handles snake_case to camelCase conversion)

export interface TextSpan {
  start: number;
  end: number;
}

export type ParseStatus = "Full" | "Partial" | "Failed";

export interface OutlineTree {
  statements: StatementOutline[];
  parse_status: ParseStatus;
}

export interface StatementOutline {
  kind: string; // "SELECT", "INSERT", etc.
  span: TextSpan;
  ctes: CteOutline[];
  tables: TableOutline[];
  subqueries: StatementOutline[];
}

export interface CteOutline {
  name: string;
  span: TextSpan;
  name_span: TextSpan;
  references: TextSpan[];
}

export interface TableOutline {
  name: string;
  alias: string | null;
  span: TextSpan;
  alias_span: TextSpan | null;
  join_type: string | null; // "INNER", "LEFT", etc.
}

// Simple cache for outline results
interface OutlineCache {
  sql: string;
  dialect: string;
  outline: OutlineTree;
}

let cache: OutlineCache | null = null;

/**
 * Check if Tauri environment is available.
 * Tauri 2 uses __TAURI_INTERNALS__ instead of __TAURI__
 */
function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * Create a failed OutlineTree for error cases.
 */
function createFailedOutline(): OutlineTree {
  return {
    statements: [],
    parse_status: "Failed",
  };
}

/**
 * Get SQL outline, with caching to avoid redundant backend calls.
 * Cache is invalidated when sql or dialect changes.
 */
export async function getOutline(
  sql: string,
  dialect: string
): Promise<OutlineTree> {
  // Return cached result if sql and dialect match
  if (cache && cache.sql === sql && cache.dialect === dialect) {
    return cache.outline;
  }

  // Check Tauri availability
  if (!isTauriAvailable()) {
    logger.warn("[refactor-service] Tauri not available, cannot get outline");
    return createFailedOutline();
  }

  try {
    logger.debug("[refactor-service] Calling sql_get_outline", { dialect, sqlLength: sql.length });
    const outline = await invoke<OutlineTree>("sql_get_outline", {
      sql,
      dialect,
    });

    logger.debug("[refactor-service] Got outline", outline);

    // Update cache
    cache = {
      sql,
      dialect,
      outline,
    };

    return outline;
  } catch (error) {
    logger.error("[refactor-service] Error getting outline:", error);
    return createFailedOutline();
  }
}

/**
 * Clear the outline cache (call when document changes significantly)
 */
export function clearOutlineCache(): void {
  cache = null;
}

// =============================================================================
// Refactoring Actions API
// =============================================================================

export interface RefactorAction {
  kind: "rename" | "extract_cte";
  label: string;
  symbol: string | null;
  span: TextSpan;
  enabled: boolean;
  disabled_reason: string | null;
}

export interface RefactorResult {
  new_sql: string;
  edits: TextEdit[];
  cursor_position: number;
}

export interface TextEdit {
  span: TextSpan;
  new_text: string;
}

export type RefactorRequest =
  | { kind: "rename"; symbol_span: TextSpan; new_name: string }
  | { kind: "extract_cte"; selection_span: TextSpan; cte_name: string };

/**
 * Get available refactor actions at cursor position
 */
export async function getRefactorActions(
  sql: string,
  dialect: string,
  cursorOffset: number
): Promise<RefactorAction[]> {
  if (!isTauriAvailable()) {
    logger.warn("[refactor-service] Tauri not available");
    return [];
  }

  try {
    return await invoke<RefactorAction[]>("sql_get_refactor_actions", {
      sql,
      dialect,
      cursorOffset,
    });
  } catch (error) {
    logger.error("[refactor-service] Error getting refactor actions:", error);
    return [];
  }
}

/**
 * Apply a refactoring action
 */
export async function applyRefactor(
  sql: string,
  dialect: string,
  action: RefactorRequest
): Promise<RefactorResult> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri not available");
  }

  return await invoke<RefactorResult>("sql_apply_refactor", {
    sql,
    dialect,
    action,
  });
}
