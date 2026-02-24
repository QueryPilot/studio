/**
 * Format-on-Paste Extension
 *
 * Automatically formats multiline SQL when pasted.
 * Single-line pastes pass through to browser default.
 */

import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "../types";

const SQL_KEYWORD_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|MERGE|GRANT|REVOKE|TRUNCATE|EXPLAIN|ANALYZE)\b/i;

/**
 * Create the format-on-paste extension.
 * Only formats multiline pastes that start with SQL keywords.
 */
export function createFormatOnPasteExtension(dialect: SqlDialect): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
    },
    {
      eventHandlers: {
        paste(event: ClipboardEvent, view: EditorView) {
          const text = event.clipboardData?.getData("text/plain");
          if (!text) return false;

          // Only format multiline pastes that look like SQL
          const hasNewline = text.includes("\n") || text.includes("\r");
          if (!hasNewline || !SQL_KEYWORD_PATTERN.test(text)) {
            return false;
          }

          event.preventDefault();

          const formatted = formatSql(text.trim(), dialect);
          const { from, to } = view.state.selection.main;

          view.dispatch({
            changes: { from, to, insert: formatted },
            selection: { anchor: from + formatted.length },
          });

          return true;
        },
      },
    },
  );
}
