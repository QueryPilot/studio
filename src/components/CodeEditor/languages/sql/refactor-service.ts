/**
 * Refactor Service
 *
 * Frontend Tauri wrapper for SQL refactoring commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import { isTauri } from "@/utils/tauri";

export interface TextSpan {
  start: number;
  end: number;
}

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
  if (!isTauri()) {
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
  if (!isTauri()) {
    throw new Error("Tauri not available");
  }

  return await invoke<RefactorResult>("sql_apply_refactor", {
    sql,
    dialect,
    action,
  });
}
