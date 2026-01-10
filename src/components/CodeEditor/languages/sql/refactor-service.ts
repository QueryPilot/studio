/**
 * Refactor Service
 *
 * Frontend Tauri wrapper for SQL refactoring commands.
 * Provides outline parsing with caching to avoid redundant backend calls.
 */

import { invoke } from "@tauri-apps/api/core";

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
 */
function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
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
    console.warn("[refactor-service] Tauri not available");
    return createFailedOutline();
  }

  try {
    const outline = await invoke<OutlineTree>("sql_get_outline", {
      sql,
      dialect,
    });

    // Update cache
    cache = {
      sql,
      dialect,
      outline,
    };

    return outline;
  } catch (error) {
    console.error("[refactor-service] Error getting outline:", error);
    return createFailedOutline();
  }
}

/**
 * Clear the outline cache (call when document changes significantly)
 */
export function clearOutlineCache(): void {
  cache = null;
}
