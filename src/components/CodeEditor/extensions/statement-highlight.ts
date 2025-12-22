/**
 * Statement Highlighting Extension
 *
 * Provides visual feedback for SQL statement blocks:
 * - Highlights the active statement (statement containing cursor)
 * - Dims inactive statements
 * - Updates decorations when cursor moves
 *
 * Performance optimization:
 * - Relies on getAllStatements() internal cache (single source of truth)
 * - StateField only tracks activeIndex (cheap O(n) lookup)
 * - Reference equality checks prevent unnecessary decoration rebuilds
 */

import { EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { getAllStatements, type StatementBoundary } from "../core/query-utils";

/**
 * Effect to update the active statement
 */
const setActiveStatementEffect = StateEffect.define<number | null>();

/**
 * Find the index of the statement containing the given cursor position.
 * Returns null if no statement contains the position.
 */
function findActiveStatement(statements: StatementBoundary[], cursorPos: number): number | null {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (stmt && cursorPos >= stmt.from && cursorPos <= stmt.to) {
      return i;
    }
  }
  return null;
}

/**
 * StateField that tracks the active statement index.
 *
 * Performance optimization:
 * - Relies on getAllStatements() internal cache for statement parsing
 * - Only tracks activeIndex (cheap O(n) lookup on selection change)
 * - Reference equality check prevents unnecessary updates
 */
const activeStatementField = StateField.define<number | null>({
  create(state) {
    const statements = getAllStatements(state);
    if (statements.length === 0) {
      return null;
    }
    return 0; // Default to first statement
  },
  update(value, tr) {
    // Check for explicit effects first
    for (const effect of tr.effects) {
      if (effect.is(setActiveStatementEffect)) {
        return effect.value;
      }
    }

    // Recalculate on document or selection change
    if (tr.docChanged || tr.selection) {
      const statements = getAllStatements(tr.state);

      // Don't highlight if no statements or empty document
      if (statements.length === 0) {
        return value === null ? value : null; // Reference equality check
      }

      const selection = tr.state.selection.main;
      const cursorPos = selection.head;

      // Check if entire document is selected (Cmd+A)
      const entireDocSelected = selection.from === 0 && selection.to === tr.state.doc.length;

      // If entire document selected, highlight the first statement
      const newActiveIndex = entireDocSelected
        ? 0
        : findActiveStatement(statements, cursorPos);

      // Reference equality check - avoid creating new value if unchanged
      return newActiveIndex === value ? value : newActiveIndex;
    }

    return value;
  },
});

/**
 * Decoration styling for active and inactive statements
 * Use line decorations to apply per-line styling
 * 
 * All statement blocks have a left border:
 * - Active (cursor in block): primary color border
 * - Inactive (other blocks): transparent border (maintains layout)
 */
const activeStatementLine = Decoration.line({
  attributes: { class: "cm-active-statement-line" },
});

const inactiveStatementLine = Decoration.line({
  attributes: { class: "cm-inactive-statement-line" },
});

/**
 * Build decorations for all statements
 *
 * All statements get a left border:
 * - Active: primary color (visible)
 * - Inactive: transparent (invisible but maintains layout)
 *
 * Performance: Uses getAllStatements() internal cache (no reparse)
 */
function buildStatementDecorations(view: EditorView): DecorationSet {
  // Don't apply decorations if document is empty or whitespace-only
  const docContent = view.state.doc.toString();
  if (!docContent.trim()) {
    return Decoration.none;
  }

  // Get statements from cache (getAllStatements has internal memoization)
  const statements = getAllStatements(view.state);

  // Don't apply decorations if no statements
  if (statements.length === 0) {
    return Decoration.none;
  }

  // Get active index from StateField
  const activeIndex = view.state.field(activeStatementField, false);

  const decorations: any[] = [];

  statements.forEach((stmt, index) => {
    // Get all line numbers for this statement
    const fromLine = view.state.doc.lineAt(stmt.from);
    const toLine = view.state.doc.lineAt(stmt.to);

    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      const line = view.state.doc.line(lineNum);

      if (index === activeIndex) {
        // Active statement - primary color border
        decorations.push(activeStatementLine.range(line.from));
      } else {
        // Inactive statement - transparent border (layout preserved)
        decorations.push(inactiveStatementLine.range(line.from));
      }
    }
  });

  return Decoration.set(decorations, true);
}

/**
 * ViewPlugin that manages statement decorations
 *
 * Performance optimization:
 * - Only rebuilds when StateField reference changes (not on viewport changes)
 * - Reference equality check leverages StateField's optimization
 */
const statementHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildStatementDecorations(view);
    }

    update(update: ViewUpdate) {
      // Only rebuild if StateField reference changed (includes doc/selection changes)
      const oldActiveIndex = update.startState.field(activeStatementField, false);
      const newActiveIndex = update.state.field(activeStatementField, false);

      if (oldActiveIndex !== newActiveIndex || update.docChanged) {
        this.decorations = buildStatementDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Theme for statement highlighting
 *
 * Only changes border COLOR - base .cm-line already has border space reserved
 * to prevent layout shift when decorations are added/removed during typing.
 */
const statementHighlightTheme = EditorView.theme({
  ".cm-active-statement-line": {
    borderLeftColor: "hsl(var(--primary))",
  },
  ".cm-inactive-statement-line": {
    // Inherits transparent border from base .cm-line
    // No change needed - keeps consistent layout
  },
});

/**
 * Create the statement highlighting extension.
 * Highlights the active statement and dims others.
 */
export function createStatementHighlightExtension(): Extension {
  return [
    activeStatementField,
    statementHighlightPlugin,
    statementHighlightTheme,
  ];
}

/**
 * Command to manually set the active statement by index.
 * Useful for programmatic control (e.g., from gutter clicks).
 */
export function setActiveStatement(index: number | null): StateEffect<number | null> {
  return setActiveStatementEffect.of(index);
}

