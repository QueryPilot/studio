import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { getAllStatements, type StatementBoundary } from "../core";

/** Above this line count, dimming of non-highlighted statements is disabled for performance. */
const DIMMING_LINE_THRESHOLD = 500;

function isSameStatement(
  left: StatementBoundary | null,
  right: StatementBoundary | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.lineStart === right.lineStart &&
    left.lineEnd === right.lineEnd
  );
}

function resolveStatementAtPosition(
  statements: StatementBoundary[],
  pos: number,
  activeStatement: StatementBoundary | null,
): StatementBoundary | null {
  if (
    activeStatement &&
    pos >= activeStatement.from &&
    pos <= activeStatement.to
  ) {
    return activeStatement;
  }

  if (statements.length === 0) {
    return null;
  }

  let low = 0;
  let high = statements.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const current = statements[mid];
    if (!current) break;
    if (pos < current.from) {
      high = mid - 1;
    } else if (pos > current.to) {
      low = mid + 1;
    } else {
      return current;
    }
  }

  if (high < 0) {
    return statements[0] ?? null;
  }
  if (low >= statements.length) {
    return statements[statements.length - 1] ?? null;
  }
  return statements[high] ?? null;
}

function statementKey(statement: StatementBoundary): string {
  return `${statement.from}:${statement.to}`;
}

function areSameStatementList(
  left: StatementBoundary[],
  right: StatementBoundary[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (!leftItem || !rightItem) return false;
    if (!isSameStatement(leftItem, rightItem)) {
      return false;
    }
  }
  return true;
}

function resolveHighlightedStatements(
  statements: StatementBoundary[],
  selectionFrom: number,
  selectionTo: number,
  activeStatement: StatementBoundary | null,
): StatementBoundary[] {
  if (selectionFrom === selectionTo) {
    return activeStatement ? [activeStatement] : [];
  }

  const rangeFrom = Math.min(selectionFrom, selectionTo);
  const rangeTo = Math.max(selectionFrom, selectionTo);
  const selected = statements.filter(
    (statement) => statement.from < rangeTo && statement.to > rangeFrom,
  );

  if (selected.length > 0) {
    return selected;
  }
  return activeStatement ? [activeStatement] : [];
}

function computeVisibleLineRange(
  view: EditorView,
  buffer: number = 50,
): { visibleStart: number; visibleEnd: number } {
  const ranges = view.visibleRanges;
  if (ranges.length === 0) {
    return { visibleStart: 1, visibleEnd: view.state.doc.lines };
  }
  const firstRange = ranges[0]!;
  const lastRange = ranges[ranges.length - 1]!;
  const firstLine = view.state.doc.lineAt(firstRange.from).number;
  const lastLine = view.state.doc.lineAt(lastRange.to).number;
  const maxLine = view.state.doc.lines;
  return {
    visibleStart: Math.max(1, firstLine - buffer),
    visibleEnd: Math.min(maxLine, lastLine + buffer),
  };
}

function buildCurrentStatementDecorations(
  view: EditorView,
  statements: StatementBoundary[],
  activeStatement: StatementBoundary | null,
  highlightedStatements: StatementBoundary[],
): DecorationSet {
  if (!activeStatement && highlightedStatements.length === 0) {
    return Decoration.none;
  }

  const activeMarker = Decoration.line({ class: "cm-current-statement-line" });
  const activeStartMarker = Decoration.line({
    class: "cm-current-statement-start",
  });
  const activeEndMarker = Decoration.line({ class: "cm-current-statement-end" });
  const selectedMarker = Decoration.line({
    class: "cm-selected-statement-line",
  });
  const selectedStartMarker = Decoration.line({
    class: "cm-selected-statement-start",
  });
  const selectedEndMarker = Decoration.line({
    class: "cm-selected-statement-end",
  });
  const dimmedMarker = Decoration.line({ class: "cm-dimmed-statement-line" });
  const builder = new RangeSetBuilder<Decoration>();
  const maxLine = view.state.doc.lines;
  const shouldDimNonHighlighted = statements.length > 1 && maxLine <= DIMMING_LINE_THRESHOLD;
  const highlightedStatementKeys = new Set(
    highlightedStatements.map(statementKey),
  );

  const { visibleStart, visibleEnd } = computeVisibleLineRange(view);

  for (const statement of statements) {
    const key = statementKey(statement);
    const isActive = isSameStatement(statement, activeStatement);
    const isHighlighted = highlightedStatementKeys.has(key);
    const shouldRender = isHighlighted || shouldDimNonHighlighted;
    if (!shouldRender) {
      continue;
    }

    if (statement.lineEnd < visibleStart || statement.lineStart > visibleEnd) {
      continue;
    }

    const lineFrom = Math.max(statement.lineStart, visibleStart);
    const lineTo = Math.min(statement.lineEnd, visibleEnd, maxLine);

    for (let lineNumber = lineFrom; lineNumber <= lineTo; lineNumber++) {
      const line = view.state.doc.line(lineNumber);
      if (isActive) {
        builder.add(line.from, line.from, activeMarker);
      } else if (isHighlighted) {
        builder.add(line.from, line.from, selectedMarker);
      } else {
        builder.add(line.from, line.from, dimmedMarker);
      }

      if (isActive && lineNumber === statement.lineStart) {
        builder.add(line.from, line.from, activeStartMarker);
      }
      if (isActive && lineNumber === statement.lineEnd) {
        builder.add(line.from, line.from, activeEndMarker);
      }

      if (!isActive && isHighlighted && lineNumber === statement.lineStart) {
        builder.add(line.from, line.from, selectedStartMarker);
      }
      if (!isActive && isHighlighted && lineNumber === statement.lineEnd) {
        builder.add(line.from, line.from, selectedEndMarker);
      }
    }
  }

  return builder.finish();
}

export function createCurrentStatementHighlightExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      statements: StatementBoundary[];
      activeStatement: StatementBoundary | null;
      highlightedStatements: StatementBoundary[];
      prevVisibleStart: number;
      prevVisibleEnd: number;

      constructor(view: EditorView) {
        this.statements = getAllStatements(view.state);
        this.activeStatement = resolveStatementAtPosition(
          this.statements,
          view.state.selection.main.head,
          null,
        );
        this.highlightedStatements = resolveHighlightedStatements(
          this.statements,
          view.state.selection.main.from,
          view.state.selection.main.to,
          this.activeStatement,
        );
        const { visibleStart, visibleEnd } = computeVisibleLineRange(view);
        this.prevVisibleStart = visibleStart;
        this.prevVisibleEnd = visibleEnd;
        this.decorations = buildCurrentStatementDecorations(
          view,
          this.statements,
          this.activeStatement,
          this.highlightedStatements,
        );
      }

      update(update: ViewUpdate) {
        if (
          !update.docChanged &&
          !update.selectionSet &&
          !update.geometryChanged
        ) {
          return;
        }

        // For geometry changes (scroll/resize), only rebuild decorations
        // if the visible range actually changed.
        if (
          !update.docChanged &&
          !update.selectionSet &&
          update.geometryChanged
        ) {
          const { visibleStart, visibleEnd } = computeVisibleLineRange(
            update.view,
          );
          if (
            visibleStart === this.prevVisibleStart &&
            visibleEnd === this.prevVisibleEnd
          ) {
            return;
          }
          this.prevVisibleStart = visibleStart;
          this.prevVisibleEnd = visibleEnd;
          this.decorations = buildCurrentStatementDecorations(
            update.view,
            this.statements,
            this.activeStatement,
            this.highlightedStatements,
          );
          return;
        }

        if (update.docChanged) {
          this.statements = getAllStatements(update.state);
        }

        const nextStatement = resolveStatementAtPosition(
          this.statements,
          update.state.selection.main.head,
          update.docChanged ? null : this.activeStatement,
        );
        const nextHighlightedStatements = resolveHighlightedStatements(
          this.statements,
          update.state.selection.main.from,
          update.state.selection.main.to,
          nextStatement,
        );

        if (
          update.docChanged ||
          !isSameStatement(this.activeStatement, nextStatement) ||
          !areSameStatementList(
            this.highlightedStatements,
            nextHighlightedStatements,
          )
        ) {
          this.activeStatement = nextStatement;
          this.highlightedStatements = nextHighlightedStatements;
          const { visibleStart, visibleEnd } = computeVisibleLineRange(
            update.view,
          );
          this.prevVisibleStart = visibleStart;
          this.prevVisibleEnd = visibleEnd;
          this.decorations = buildCurrentStatementDecorations(
            update.view,
            this.statements,
            nextStatement,
            nextHighlightedStatements,
          );
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}
