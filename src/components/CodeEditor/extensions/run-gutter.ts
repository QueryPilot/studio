/**
 * Run Gutter Extension
 *
 * Injects play buttons into the lint gutter for each SQL statement.
 * Shows play button at the FIRST LINE of each statement.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { StateField, type Extension } from "@codemirror/state";
import { lintGutter } from "@codemirror/lint";
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

        const gutterElements = lintGutter.querySelectorAll(".cm-gutterElement");

        gutterElements.forEach((element, index) => {
          // Calculate actual line number: first visible line + index
          const lineNum = firstLine + index;

          // Skip if beyond viewport
          if (lineNum > lastLine) return;

          const stmt = statements.get(lineNum);

          // Only hide play button on ERROR (not warning/info)
          const hasErrorMarker = element.querySelector(".cm-lint-marker-error");
          const existingPlayButton = element.querySelector(
            ".cm-run-gutter-button",
          );

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
    // Include lint gutter with custom icons
    lintGutter({
      markerDOM(diagnostics) {
        const div = document.createElement("div");
        div.className = "cm-lint-marker";

        // Find highest severity
        const hasError = diagnostics.some((d) => d.severity === "error");
        const hasWarning = diagnostics.some((d) => d.severity === "warning");

        // Create SVG icon
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("width", "14");
        svg.setAttribute("height", "14");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("fill", "currentColor");

        if (hasError) {
          div.className += " cm-lint-marker-error";
          // X Circle icon for errors
          svg.innerHTML = `<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>`;
        } else if (hasWarning) {
          div.className += " cm-lint-marker-warning";
          // Alert triangle icon for warnings
          svg.innerHTML = `<path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.146.146 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.163.163 0 0 1-.054.06.116.116 0 0 1-.066.017H1.146a.115.115 0 0 1-.066-.017.163.163 0 0 1-.054-.06.176.176 0 0 1 .002-.183L7.884 2.073a.147.147 0 0 1 .054-.057zm1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566z"/>
            <path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995z"/>`;
        } else {
          div.className += " cm-lint-marker-info";
          // Info circle icon for info
          svg.innerHTML = `<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>`;
        }

        div.appendChild(svg);
        return div;
      },
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
      // Lint marker styles
      ".cm-lint-marker": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "14px",
        height: "14px",
        cursor: "pointer",
      },
      ".cm-lint-marker-error": {
        color: "hsl(var(--destructive))",
      },
      ".cm-lint-marker-warning": {
        color: "hsl(45 93% 47%)", // Amber/yellow for warnings
      },
      ".cm-lint-marker-info": {
        color: "hsl(var(--primary))",
      },
      ".cm-lint-marker svg": {
        display: "block",
        width: "14px",
        height: "14px",
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
