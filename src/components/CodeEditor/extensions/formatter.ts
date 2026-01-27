/**
 * SQL Formatter Extension
 *
 * Format SQL on Cmd+Shift+F (Mac) or Ctrl+Shift+F (Windows/Linux)
 *
 * Uses token-based cursor preservation to maintain cursor position
 * after formatting, supporting multi-cursor editing.
 */

import { type EditorView, keymap } from "@codemirror/view";
import { Prec, EditorSelection, type Extension, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "../types";

// ============ Token Anchor Types ============

interface TokenAnchor {
  tokenIndex: number;      // Number of tokens before cursor
  fallbackLine: number;    // Fallback: line number
  fallbackCol: number;     // Fallback: column in line
}

// ============ Token Position Helpers ============

/**
 * Count tokens before a position using Lezer syntax tree.
 * Only counts leaf nodes (actual tokens), not parent nodes.
 */
function getTokenAnchor(state: EditorState, pos: number): TokenAnchor {
  const tree = syntaxTree(state);
  let tokenIndex = 0;

  // Walk tree nodes up to cursor position
  tree.iterate({
    from: 0,
    to: pos,
    enter(node) {
      // Only count leaf nodes (actual tokens)
      if (node.node.firstChild === null && node.from < pos) {
        tokenIndex++;
      }
    }
  });

  // Fallback position (line + column)
  const line = state.doc.lineAt(pos);

  return {
    tokenIndex,
    fallbackLine: line.number,
    fallbackCol: pos - line.from,
  };
}

/**
 * Find position after N tokens in formatted document.
 * Falls back to line+column if token count doesn't match.
 */
function restoreFromTokenAnchor(state: EditorState, anchor: TokenAnchor): number {
  const tree = syntaxTree(state);
  let tokenIndex = 0;
  let targetPos = 0;

  try {
    tree.iterate({
      enter(node) {
        if (node.node.firstChild === null) { // Leaf node = token
          tokenIndex++;
          if (tokenIndex === anchor.tokenIndex) {
            targetPos = node.to; // Position after this token
            return false; // Stop iteration
          }
        }
        return undefined; // Continue iteration
      }
    });
  } catch {
    // Parse error - use fallback
  }

  // If token count changed (rare) or no tokens found, use fallback
  if (tokenIndex < anchor.tokenIndex || (anchor.tokenIndex > 0 && targetPos === 0)) {
    const lineCount = state.doc.lines;
    const targetLine = Math.min(anchor.fallbackLine, lineCount);
    const line = state.doc.line(targetLine);
    return Math.min(line.from + anchor.fallbackCol, line.to);
  }

  return targetPos;
}

// ============ Format Function ============

/**
 * Format the entire document or selection with token-based cursor preservation.
 * Supports multi-cursor editing.
 */
function formatDocument(view: EditorView, dialect: SqlDialect): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;

  // Determine if we have a selection
  const hasSelection = from !== to;
  const textToFormat = hasSelection
    ? state.doc.sliceString(from, to)
    : state.doc.toString();

  try {
    const formatted = formatSql(textToFormat, dialect);

    if (formatted === textToFormat) {
      // No changes needed
      return true;
    }

    if (hasSelection) {
      // Format selection only - keep selection around formatted text
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: { anchor: from, head: from + formatted.length },
      });
    } else {
      // Capture ALL selection ranges for multi-cursor support
      const anchors = state.selection.ranges.map(range => ({
        anchor: getTokenAnchor(state, range.anchor),
        head: getTokenAnchor(state, range.head),
      }));

      // Format entire document
      view.dispatch({
        changes: { from: 0, to: state.doc.length, insert: formatted },
      });

      // Restore all cursor positions using token anchors
      const newState = view.state;
      const newRanges = anchors.map(({ anchor, head }) => {
        const newAnchor = restoreFromTokenAnchor(newState, anchor);
        const newHead = restoreFromTokenAnchor(newState, head);
        return EditorSelection.range(newAnchor, newHead);
      });

      view.dispatch({
        selection: EditorSelection.create(newRanges),
      });
    }

    return true;
  } catch {
    // Formatting failed, do nothing
    return false;
  }
}

/**
 * Create SQL formatter extension with high precedence to override other keybindings
 */
export function createFormatterExtension(dialect: SqlDialect = "postgresql"): Extension[] {
  return [
    Prec.high(keymap.of([
      {
        key: "Mod-Shift-f",
        run: (view) => formatDocument(view, dialect),
        preventDefault: true,
      },
      // Alternative binding
      {
        key: "Alt-Shift-f",
        run: (view) => formatDocument(view, dialect),
        preventDefault: true,
      },
    ])),
  ];
}

/**
 * Format SQL in an editor view programmatically
 */
export function formatEditorContent(view: EditorView, dialect: SqlDialect): void {
  formatDocument(view, dialect);
}
