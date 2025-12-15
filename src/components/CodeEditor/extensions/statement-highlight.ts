/**
 * Statement Highlighting Extension
 * 
 * Provides visual feedback for SQL statement blocks:
 * - Highlights the active statement (statement containing cursor)
 * - Dims inactive statements
 * - Updates decorations when cursor moves
 */

import { EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { getAllStatements } from "../core/query-utils";

/**
 * Effect to update the active statement
 */
const setActiveStatementEffect = StateEffect.define<number | null>();

/**
 * StateField that tracks which statement is currently active (contains cursor)
 */
const activeStatementField = StateField.define<number | null>({
  create() {
    return null;
  },
  update(value, tr) {
    // Check for explicit effects first
    for (const effect of tr.effects) {
      if (effect.is(setActiveStatementEffect)) {
        return effect.value;
      }
    }

    // If selection changed, recalculate active statement
    if (tr.selection || tr.docChanged) {
      const statements = getAllStatements(tr.state);
      
      // Don't highlight if no statements or empty document
      if (statements.length === 0) {
        return null;
      }

      const selection = tr.state.selection.main;
      const cursorPos = selection.head;
      
      // Check if entire document is selected (Cmd+A)
      const entireDocSelected = selection.from === 0 && selection.to === tr.state.doc.length;
      
      // If entire document selected, highlight the first statement
      if (entireDocSelected && statements.length > 0) {
        return 0;
      }
      
      // Find which statement contains the cursor
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt && cursorPos >= stmt.from && cursorPos <= stmt.to) {
          return i;
        }
      }
      
      return null;
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
 */
function buildStatementDecorations(view: EditorView): DecorationSet {
  const statements = getAllStatements(view.state);
  
  // Don't apply decorations if no statements
  if (statements.length === 0) {
    return Decoration.none;
  }

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
 */
const statementHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildStatementDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild decorations if document or selection changed
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
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
 * Border is always present (2px) to maintain consistent layout:
 * - Active: primary color
 * - Inactive: transparent (invisible but space preserved)
 */
const statementHighlightTheme = EditorView.theme({
  ".cm-active-statement-line": {
    borderLeft: "2px solid hsl(var(--primary))",
    paddingLeft: "4px",
  },
  ".cm-inactive-statement-line": {
    borderLeft: "2px solid transparent",
    paddingLeft: "4px",
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

