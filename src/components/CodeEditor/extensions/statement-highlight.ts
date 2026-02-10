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
 * Lightweight state to track cursor position for deferred highlighting.
 * Avoids heavy getAllStatements() call on every keystroke.
 */
interface ActiveStatementState {
  index: number | null;
  cursorPos: number;
  docLength: number;
}

/**
 * StateField that tracks the active statement index.
 *
 * Performance optimization:
 * - Defers getAllStatements() calculation - only stores cursor position
 * - ViewPlugin does the actual heavy lifting with debouncing
 * - Reference equality check prevents unnecessary updates
 */
const activeStatementField = StateField.define<ActiveStatementState>({
  create(state) {
    // Lightweight initial state - actual index computed by ViewPlugin
    return {
      index: 0,
      cursorPos: state.selection.main.head,
      docLength: state.doc.length,
    };
  },
  update(value, tr) {
    // Check for explicit effects first
    for (const effect of tr.effects) {
      if (effect.is(setActiveStatementEffect)) {
        return {
          ...value,
          index: effect.value,
        };
      }
    }

    // Only update cursor position tracking - don't call getAllStatements here
    if (tr.docChanged || tr.selection) {
      const newCursorPos = tr.state.selection.main.head;
      const newDocLength = tr.state.doc.length;

      // Skip update if nothing relevant changed
      if (value.cursorPos === newCursorPos && value.docLength === newDocLength) {
        return value;
      }

      return {
        index: value.index, // Keep old index until ViewPlugin updates it
        cursorPos: newCursorPos,
        docLength: newDocLength,
      };
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
function buildStatementDecorations(
  view: EditorView,
  statements: StatementBoundary[],
  activeIndex: number | null
): DecorationSet {
  // Don't apply decorations if no statements
  if (statements.length === 0) {
    return Decoration.none;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decorations: any[] = [];

  // Viewport-aware: only decorate statements that overlap the visible area
  const { from: vpFrom, to: vpTo } = view.viewport;

  statements.forEach((stmt, index) => {
    // Skip statements entirely outside the viewport
    if (stmt.to < vpFrom || stmt.from > vpTo) return;

    // Get all line numbers for this statement
    const fromLine = view.state.doc.lineAt(stmt.from);
    const toLine = view.state.doc.lineAt(stmt.to);

    // Clamp iteration to viewport range
    const vpFirstLine = view.state.doc.lineAt(vpFrom).number;
    const vpLastLine = view.state.doc.lineAt(vpTo).number;
    const startLine = Math.max(fromLine.number, vpFirstLine);
    const endLine = Math.min(toLine.number, vpLastLine);

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
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
 * - Debounces ALL updates (doc changes + selection) to avoid lag during typing
 * - Heavy getAllStatements() work happens here, not in StateField
 * - Keeps old decorations visible during debounce for smooth UX
 */
const statementHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private view: EditorView;
    private pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    private cachedStatements: StatementBoundary[] = [];
    private lastDocLength = 0;
    private docChangedSinceLastCompute = false;

    constructor(view: EditorView) {
      this.view = view;
      // Initial computation - can be slow on first load but that's okay
      this.lastDocLength = view.state.doc.length;
      if (view.state.doc.length > 0) {
        this.cachedStatements = getAllStatements(view.state);
        const cursorPos = view.state.selection.main.head;
        const activeIndex = findActiveStatement(this.cachedStatements, cursorPos);
        this.decorations = buildStatementDecorations(view, this.cachedStatements, activeIndex);
      } else {
        this.decorations = Decoration.none;
      }
    }

    update(update: ViewUpdate) {
      // Skip if document is empty
      if (update.state.doc.length === 0) {
        this.decorations = Decoration.none;
        return;
      }

      const stateField = update.state.field(activeStatementField, false);
      if (!stateField) return;

      if (update.docChanged) {
        this.docChangedSinceLastCompute = true;
      }

      // Skip recompute for unfocused editors (keep stale decorations)
      if (!update.view.hasFocus) return;

      // Cancel any pending update
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate);
      }

      // Debounce both doc changes and selection changes
      // This is key to preventing lag during rapid typing/deleting
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;

        // Use this.view.state (always current) instead of closed-over update.state
        const currentState = this.view.state;

        // Recompute statements if document changed (length or content)
        if (this.docChangedSinceLastCompute || currentState.doc.length !== this.lastDocLength) {
          this.cachedStatements = getAllStatements(currentState);
          this.lastDocLength = currentState.doc.length;
          this.docChangedSinceLastCompute = false;
        }

        // Find active statement based on cursor position
        const cursorPos = currentState.selection.main.head;
        const activeIndex = findActiveStatement(this.cachedStatements, cursorPos);

        // Rebuild decorations
        this.decorations = buildStatementDecorations(
          this.view,
          this.cachedStatements,
          activeIndex
        );

        // Request re-render
        this.view.requestMeasure();
      }, 100); // 100ms debounce - feels instant but prevents lag
    }

    destroy() {
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate);
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

