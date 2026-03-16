/**
 * SQL Refactoring Extension
 *
 * Provides refactoring features:
 * - F2: Rename symbol (alias, CTE, column alias)
 * - Cmd+Shift+E: Extract to CTE
 * - Cmd+.: Show code actions (lightbulb)
 * - Context menu integration
 */

import { type Extension, Prec } from "@codemirror/state";
import {
  keymap,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  type EditorView,
} from "@codemirror/view";
import { logger } from "@/lib/logger";
import { startRename, createInlineRenameExtension } from "./inline-rename";
import type { RefactorAction } from "../languages/sql/refactor-service";
import { getRefactorActions } from "../languages/sql/refactor-service";

export interface RefactorOptions {
  dialect: string;
  onExtractCte?: (selectionSpan: { start: number; end: number }) => void;
}

interface ExecuteRefactorOptions {
  onExtractCte?: (selectionSpan: { start: number; end: number }) => void;
  sourceCursorOffset?: number;
}

interface MenuPosition {
  left: number;
  top: number;
}

function areActionsEquivalent(
  left: RefactorAction,
  right: RefactorAction,
): boolean {
  return (
    left.kind === right.kind &&
    left.label === right.label &&
    left.symbol === right.symbol &&
    left.enabled === right.enabled &&
    left.span.start === right.span.start &&
    left.span.end === right.span.end
  );
}

function areActionListsEquivalent(
  left: RefactorAction[],
  right: RefactorAction[],
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const leftAction = left[i];
    const rightAction = right[i];
    if (!leftAction || !rightAction) return false;
    if (!areActionsEquivalent(leftAction, rightAction)) return false;
  }
  return true;
}

function clampOffset(offset: number, docLength: number): number {
  return Math.max(0, Math.min(offset, docLength));
}

async function resolveActionAgainstCurrentState(
  view: EditorView,
  action: RefactorAction,
  dialect: string,
  sourceCursorOffset?: number,
): Promise<RefactorAction | null> {
  if (!action.enabled) return null;

  const sql = view.state.doc.toString();
  const docLength = sql.length;
  const currentCursor = clampOffset(view.state.selection.main.from, docLength);
  const fallbackCursor = clampOffset(
    sourceCursorOffset ?? action.span.start,
    docLength,
  );
  const candidateOffsets =
    currentCursor === fallbackCursor
      ? [currentCursor]
      : [currentCursor, fallbackCursor];

  for (const cursorOffset of candidateOffsets) {
    const actions = await getRefactorActions(sql, dialect, cursorOffset);
    const exact = actions.find(
      (candidate) => candidate.enabled && areActionsEquivalent(candidate, action),
    );
    if (exact) {
      return exact;
    }

    const sameKindFallback = actions.find(
      (candidate) =>
        candidate.enabled &&
        candidate.kind === action.kind &&
        candidate.symbol === action.symbol,
    );
    if (sameKindFallback) {
      return sameKindFallback;
    }
  }

  return null;
}

/**
 * Execute a refactor action from any UI entry point (lightbulb, keymap, etc.).
 */
export async function executeRefactorAction(
  view: EditorView,
  action: RefactorAction,
  dialect: string,
  options: ExecuteRefactorOptions = {},
): Promise<void> {
  const latestAction = await resolveActionAgainstCurrentState(
    view,
    action,
    dialect,
    options.sourceCursorOffset,
  );
  if (!latestAction) {
    logger.warn(
      "[Refactor] Action no longer valid in current editor state; skipping execution",
      {
        requestedAction: action,
      },
    );
    return;
  }

  if (latestAction.kind === "rename") {
    view.dispatch({
      selection: { anchor: latestAction.span.start },
    });
    await startRename(view, dialect);
    return;
  }

  const span = {
    start: latestAction.span.start,
    end: latestAction.span.end,
  };

  // Select the extractable range so the dialog context is visible to the user.
  view.dispatch({
    selection: { anchor: span.start, head: span.end },
  });

  options.onExtractCte?.(span);
}

function showRefactorMenu(params: {
  view: EditorView;
  actions: RefactorAction[];
  dialect: string;
  position: MenuPosition;
  anchorEl?: HTMLElement;
  onExtractCte?: (selectionSpan: { start: number; end: number }) => void;
  sourceCursorOffset?: number;
}) {
  const {
    view,
    actions,
    dialect,
    position,
    anchorEl,
    onExtractCte,
    sourceCursorOffset,
  } = params;
  if (actions.length === 0) return;

  const menu = document.createElement("div");
  menu.className = "cm-refactor-menu";
  menu.style.cssText = `
    position: absolute;
    background: var(--popover);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius));
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 200px;
    padding: 4px;
  `;
  menu.style.left = `${position.left}px`;
  menu.style.top = `${position.top}px`;

  let listenerRaf: number | null = null;

  const removeMenu = () => {
    // Cancel pending listener registration (M3 fix: prevents leak if menu removed early)
    if (listenerRaf !== null) {
      cancelAnimationFrame(listenerRaf);
      listenerRaf = null;
    }
    if (menu.parentNode) {
      document.body.removeChild(menu);
    }
    document.removeEventListener("mousedown", closeMenu);
  };

  const closeMenu = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (menu.contains(target)) return;
    if (anchorEl && target === anchorEl) return;
    removeMenu();
  };

  for (const action of actions) {
    const item = document.createElement("button");
    item.className = "cm-refactor-menu-item";
    item.textContent = action.label;
    item.disabled = !action.enabled;
    item.title = action.disabled_reason || "";
    item.style.cssText = `
      display: block;
      width: 100%;
      text-align: left;
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-radius: calc(var(--radius) - 2px);
      cursor: ${action.enabled ? "pointer" : "not-allowed"};
      font-size: 13px;
      color: ${action.enabled ? "var(--foreground)" : "var(--muted-foreground)"};
      transition: background 0.15s;
    `;

    if (action.enabled) {
      item.onmouseenter = () => {
        item.style.background = "var(--accent)";
      };
      item.onmouseleave = () => {
        item.style.background = "transparent";
      };
      item.onclick = () => {
        void executeRefactorAction(view, action, dialect, {
          onExtractCte,
          sourceCursorOffset,
        });
        removeMenu();
      };
    }

    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  // Defer listener to next frame to avoid closing on the same click that opened the menu
  listenerRaf = requestAnimationFrame(() => {
    listenerRaf = null;
    document.addEventListener("mousedown", closeMenu);
  });
}

/**
 * Lightbulb widget for code actions
 */
class LightbulbWidget extends WidgetType {
  constructor(
    private actions: RefactorAction[],
    private line: number,
    private dialect: string,
    private cursorOffset: number,
    private onExtractCte?: (selectionSpan: { start: number; end: number }) => void
  ) {
    super();
  }

  eq(other: LightbulbWidget) {
    return (
      this.line === other.line &&
      this.dialect === other.dialect &&
      this.cursorOffset === other.cursorOffset &&
      areActionListsEquivalent(this.actions, other.actions)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.className = "cm-lightbulb";
    button.textContent = "💡";
    button.title = `${this.actions.length} refactoring${this.actions.length > 1 ? "s" : ""} available`;
    button.style.cssText = `
      position: absolute;
      left: -20px;
      font-size: 14px;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0;
      opacity: 0.7;
      transition: opacity 0.2s, transform 0.2s;
    `;

    button.onmouseenter = () => {
      button.style.opacity = "1";
      button.style.transform = "scale(1.1)";
    };
    button.onmouseleave = () => {
      button.style.opacity = "0.7";
      button.style.transform = "scale(1)";
    };

    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = button.getBoundingClientRect();
      showRefactorMenu({
        view,
        actions: this.actions,
        dialect: this.dialect,
        position: { left: rect.right + 8, top: rect.top },
        anchorEl: button,
        onExtractCte: this.onExtractCte,
        sourceCursorOffset: this.cursorOffset,
      });
    };

    return button;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * Create refactoring extension with keybindings and code actions
 */
export function createRefactoringExtension(options: RefactorOptions): Extension {
  const { dialect, onExtractCte } = options;

  // Keybindings
  const refactorKeymap = Prec.high(
    keymap.of([
      {
        key: "F2",
        run: (view) => {
          void startRename(view, dialect);
          return true;
        },
      },
      {
        key: "Mod-Shift-e",
        run: (view) => {
          const selection = view.state.selection.main;
          if (selection.from !== selection.to && onExtractCte) {
            onExtractCte({
              start: selection.from,
              end: selection.to,
            });
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-.",
        run: (view): true => {
          // Show code actions at cursor
          const pos = view.state.selection.main.from;
          const doc = view.state.doc;
          const sql = doc.toString();

          void getRefactorActions(sql, dialect, pos)
            .then((actions) => {
              if (actions.length === 0) return;
              if (view.state.doc !== doc || view.state.selection.main.from !== pos) {
                return;
              }

              const coords = view.coordsAtPos(pos);
              if (!coords) {
                logger.info("[Refactor] Code actions available:", actions);
                return;
              }

              showRefactorMenu({
                view,
                actions,
                dialect,
                position: { left: coords.left, top: coords.bottom + 4 },
                onExtractCte,
                sourceCursorOffset: pos,
              });
            })
            .catch((error: unknown) => {
              logger.error("[Refactor] Failed to get code actions:", error);
            });

          return true;
        },
      },
    ])
  );

  // Lightbulb code actions plugin (debounced)
  const lightbulbPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      pendingUpdate: ReturnType<typeof setTimeout> | null = null;
      lastAnalyzedLine: number = -1;
      requestVersion: number = 0;

      update(update: ViewUpdate) {
        // Only run expensive IPC for the focused editor
        if (!update.view.hasFocus) return;

        // Debounce updates when cursor moves
        if (update.selectionSet || update.docChanged) {
          // Check if we've moved to a different line
          const pos = update.state.selection.main.from;
          const currentLine = update.state.doc.lineAt(pos).number;

          // Skip IPC if cursor stayed on same line and doc didn't change
          if (currentLine === this.lastAnalyzedLine && !update.docChanged) {
            return;
          }

          if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
          }

          this.pendingUpdate = setTimeout(async () => {
            try {
              if (update.view.dom.isConnected && update.view.hasFocus) {
                // Read line from current view state, not the stale closure
                const currentPos = update.view.state.selection.main.from;
                this.lastAnalyzedLine = update.view.state.doc.lineAt(currentPos).number;
                const requestVersion = ++this.requestVersion;
                await this.updateLightbulbs(update.view, requestVersion);
              }
            } finally {
              this.pendingUpdate = null;
            }
          }, 150); // 150ms debounce
        }
      }

      destroy() {
        this.requestVersion += 1;
        if (this.pendingUpdate) {
          clearTimeout(this.pendingUpdate);
        }
      }

      async updateLightbulbs(view: EditorView, requestVersion: number) {
        const pos = view.state.selection.main.from;
        const doc = view.state.doc;
        const sql = view.state.doc.toString();

        try {
          const actions = await getRefactorActions(sql, dialect, pos);
          if (requestVersion !== this.requestVersion) {
            return;
          }
          if (
            !view.dom.isConnected ||
            !view.hasFocus ||
            view.state.doc !== doc ||
            view.state.selection.main.from !== pos
          ) {
            return;
          }

          if (actions.length > 0) {
            // Show lightbulb at current line
            const line = view.state.doc.lineAt(pos);
            const lineNumber = line.number;

            this.decorations = Decoration.set([
              Decoration.widget({
                widget: new LightbulbWidget(
                  actions,
                  lineNumber,
                  dialect,
                  pos,
                  onExtractCte,
                ),
                side: -1,
              }).range(line.from),
            ]);
          } else {
            this.decorations = Decoration.none;
          }
        } catch (error) {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          logger.error("[Refactor] Failed to get actions:", error);
          this.decorations = Decoration.none;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  return [
    refactorKeymap,
    createInlineRenameExtension(dialect),
    lightbulbPlugin,
  ];
}
