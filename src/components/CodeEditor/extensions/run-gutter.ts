/**
 * Run Gutter Extension
 *
 * Injects play buttons into the lint gutter for each SQL statement.
 * Shows play button at the FIRST LINE of each statement.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { StateField, type Extension } from "@codemirror/state";
import { forEachDiagnostic, lintGutter } from "@codemirror/lint";
import { getAllStatements, type StatementBoundary } from "../core/query-utils";

/**
 * StateField to track statement boundaries
 * Maps line number (1-based) -> statement for FIRST LINE of each statement
 */
const statementsField = StateField.define<Map<number, StatementBoundary>>({
  create(state) {
    const map = new Map<number, StatementBoundary>();
    // Don't track statements if document is empty
    if (!state.doc.toString().trim()) return map;

    const statements = getAllStatements(state);
    statements.forEach((stmt) => {
      const lineNum = state.doc.lineAt(stmt.from).number; // 1-based
      map.set(lineNum, stmt);
    });
    return map;
  },
  update(map, tr) {
    if (tr.docChanged) {
      const newMap = new Map<number, StatementBoundary>();
      // Don't track statements if document is empty
      if (!tr.state.doc.toString().trim()) return newMap;

      const statements = getAllStatements(tr.state);
      statements.forEach((stmt) => {
        const lineNum = tr.state.doc.lineAt(stmt.from).number; // 1-based
        newMap.set(lineNum, stmt);
      });
      return newMap;
    }
    return map;
  },
});

/**
 * ViewPlugin that injects play buttons into lint gutter
 */
function createRunGutterPlugin(onExecute: (query: string) => void) {
  return ViewPlugin.fromClass(
    class {
      private pendingUpdate: number | null = null;
      private observer: MutationObserver | null = null;

      constructor(private view: EditorView) {
        this.setupObserver();
        this.scheduleUpdate();
      }

      setupObserver() {
        const lintGutter = this.view.dom.querySelector(".cm-gutter-lint");
        if (lintGutter) {
          this.observer = new MutationObserver(() => {
            this.scheduleUpdate();
          });
          this.observer.observe(lintGutter, {
            childList: true,
            subtree: true,
            attributes: false,
          });
        }
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet
        ) {
          this.scheduleUpdate();
        }
      }

      scheduleUpdate() {
        if (this.pendingUpdate !== null) return;

        this.pendingUpdate = requestAnimationFrame(() => {
          this.pendingUpdate = null;
          this.updateGutter();
        });
      }

      updateGutter() {
        // Don't show play buttons if document is empty or whitespace-only
        const docContent = this.view.state.doc.toString();
        if (!docContent.trim()) return;

        const statements = this.view.state.field(statementsField, false);
        if (!statements || statements.size === 0) return;

        const lintGutter = this.view.dom.querySelector(".cm-gutter-lint");
        if (!lintGutter) {
          this.setupObserver();
          return;
        }

        // Get viewport range
        const { from, to } = this.view.viewport;
        const firstLine = this.view.state.doc.lineAt(from).number;
        const lastLine = this.view.state.doc.lineAt(to).number;

        // Compute error lines from diagnostics directly (do not depend on gutter dots).
        const errorLines = new Set<number>();
        forEachDiagnostic(this.view.state, (diagnostic) => {
          if (diagnostic.severity === "error") {
            const line = this.view.state.doc.lineAt(diagnostic.from).number;
            errorLines.add(line);
          }
        });

        const gutterElements = lintGutter.querySelectorAll(".cm-gutterElement");

        gutterElements.forEach((element, index) => {
          // Calculate actual line number: first visible line + index
          const lineNum = firstLine + index;

          // Skip if beyond viewport
          if (lineNum > lastLine) return;

          const stmt = statements.get(lineNum);

          // Only hide play button on ERROR (not warning/info)
          const hasErrorMarker = errorLines.has(lineNum);
          const existingPlayButton = element.querySelector(
            ".cm-run-gutter-button",
          );

          // Remove lint dots from the left gutter; lint position is shown in right scrollbar markers.
          element
            .querySelectorAll(
              ".cm-lintPoint, .cm-lintPoint-error, .cm-lintPoint-warning, .cm-lintPoint-info",
            )
            .forEach((node) => {
              node.remove();
            });

          // Remove existing button
          if (existingPlayButton) {
            existingPlayButton.remove();
          }

          // Add play button if this line starts a statement and has no error
          if (stmt && !hasErrorMarker) {
            const button = document.createElement("button");
            button.className = "cm-run-gutter-button";
            button.setAttribute("aria-label", "Run this query");
            button.setAttribute("title", "Run this query");

            button.innerHTML = `
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            `;

            button.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              onExecute(stmt.text);
            };

            element.appendChild(button);
          }
        });
      }

      destroy() {
        if (this.pendingUpdate !== null) {
          cancelAnimationFrame(this.pendingUpdate);
        }
        if (this.observer) {
          this.observer.disconnect();
        }
      }
    },
  );
}

/**
 * Create the run gutter extension that adds play buttons inside the lint gutter
 */
export function createRunGutterExtension(
  onExecute: (query: string) => void,
): Extension {
  return [
    // Include lint gutter
    lintGutter({
      hoverTime: 300, // Wait 300ms before showing tooltip (reduces accidental popups)
      // We use the gutter column for run buttons only.
      // Lint positions are shown via inline diagnostics + right scrollbar markers.
      markerFilter: () => [],
    }),

    // Track statements
    statementsField,

    // Inject play buttons
    createRunGutterPlugin(onExecute),

    // Theme for play button and lint markers
    EditorView.theme({
      ".cm-gutter-lint": {
        width: "20px", // Fixed width to prevent layout shift
        minWidth: "20px",
      },
      ".cm-gutter-lint .cm-gutterElement": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center", // Center content in fixed-width gutter
        width: "20px",
        padding: "0 !important",
      },
      // Hide default lint markers; diagnostics are surfaced via right-side scrollbar markers.
      ".cm-gutter-lint .cm-lintPoint, .cm-gutter-lint .cm-lintPoint-error, .cm-gutter-lint .cm-lintPoint-warning, .cm-gutter-lint .cm-lintPoint-info": {
        display: "none !important",
      },
      // Play button styles
      ".cm-run-gutter-button": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "14px",
        height: "14px",
        padding: "0",
        margin: "0",
        border: "none",
        borderRadius: "3px",
        backgroundColor: "transparent",
        color: "hsl(var(--muted-foreground))",
        cursor: "pointer",
        transition: "all 0.15s ease",
        outline: "none",
        verticalAlign: "middle",
        flexShrink: 0,
      },
      ".cm-run-gutter-button:hover": {
        backgroundColor: "hsl(var(--primary) / 0.1)",
        color: "hsl(var(--primary))",
        transform: "scale(1.15)",
      },
      ".cm-run-gutter-button:active": {
        transform: "scale(0.95)",
      },
      ".cm-run-gutter-button svg": {
        display: "block",
        width: "10px",
        height: "10px",
      },
    }),
  ];
}
