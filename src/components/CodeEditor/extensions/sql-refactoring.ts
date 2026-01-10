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
import { EditorView, keymap, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { logger } from "@/lib/logger";
import { startRename, createInlineRenameExtension } from "./inline-rename";
import type { RefactorAction } from "../languages/sql/refactor-service";
import { getRefactorActions } from "../languages/sql/refactor-service";

export interface RefactorOptions {
  dialect: string;
  onExtractCte?: (selectionSpan: { start: number; end: number }) => void;
}

/**
 * Lightbulb widget for code actions
 */
class LightbulbWidget extends WidgetType {
  constructor(
    private actions: RefactorAction[],
    private line: number,
    private dialect: string
  ) {
    super();
  }

  eq(other: LightbulbWidget) {
    return (
      this.line === other.line &&
      this.actions.length === other.actions.length &&
      this.dialect === other.dialect
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
      this.showActionsMenu(view, button);
    };

    return button;
  }

  private showActionsMenu(view: EditorView, button: HTMLElement) {
    // Create a simple menu (you could use a proper dropdown component)
    const menu = document.createElement("div");
    menu.className = "cm-refactor-menu";
    menu.style.cssText = `
      position: absolute;
      background: hsl(var(--popover));
      border: 1px solid hsl(var(--border));
      border-radius: calc(var(--radius));
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      min-width: 200px;
      padding: 4px;
    `;

    const rect = button.getBoundingClientRect();
    menu.style.left = `${rect.right + 8}px`;
    menu.style.top = `${rect.top}px`;

    for (const action of this.actions) {
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
        color: ${action.enabled ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
        transition: background 0.15s;
      `;

      if (action.enabled) {
        item.onmouseenter = () => {
          item.style.background = "hsl(var(--accent))";
        };
        item.onmouseleave = () => {
          item.style.background = "transparent";
        };
        item.onclick = () => {
          this.executeAction(view, action);
          document.body.removeChild(menu);
        };
      }

      menu.appendChild(item);
    }

    // Close menu when clicking outside
    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== button) {
        if (menu.parentNode) {
          document.body.removeChild(menu);
        }
        document.removeEventListener("mousedown", closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", closeMenu);
    }, 0);

    document.body.appendChild(menu);
  }

  private async executeAction(view: EditorView, action: RefactorAction) {
    if (action.kind === "rename") {
      // Trigger rename at the action's span
      view.dispatch({
        selection: { anchor: action.span.start },
      });
      // The rename widget will be shown by the inline-rename extension
      await startRename(view, this.dialect);
    } else if (action.kind === "extract_cte") {
      // Trigger extract CTE dialog
      // This would need to be handled by the parent component
      logger.info("[Refactor] Extract CTE action triggered", action);
    }
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
          startRename(view, dialect);
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
        run: (view) => {
          // Show code actions at cursor
          const pos = view.state.selection.main.from;
          const sql = view.state.doc.toString();

          // Trigger async action in background
          getRefactorActions(sql, dialect, pos)
            .then((actions) => {
              if (actions.length > 0) {
                logger.info("[Refactor] Code actions available:", actions);
                // You could dispatch a custom event here to show the menu
              }
            })
            .catch((error) => {
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

      constructor(_view: EditorView) {
        // Don't update on construction to avoid initial flash
      }

      update(update: ViewUpdate) {
        // Debounce updates when cursor moves
        if (update.selectionSet || update.docChanged) {
          if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
          }

          this.pendingUpdate = setTimeout(async () => {
            if (update.view.dom.isConnected) {
              await this.updateLightbulbs(update.view);
              this.pendingUpdate = null;
            }
          }, 150); // 150ms debounce
        }
      }

      destroy() {
        if (this.pendingUpdate) {
          clearTimeout(this.pendingUpdate);
        }
      }

      async updateLightbulbs(view: EditorView) {
        const pos = view.state.selection.main.from;
        const sql = view.state.doc.toString();

        try {
          const actions = await getRefactorActions(sql, dialect, pos);
          
          if (actions.length > 0) {
            // Show lightbulb at current line
            const line = view.state.doc.lineAt(pos);
            const lineNumber = line.number;

            this.decorations = Decoration.set([
              Decoration.widget({
                widget: new LightbulbWidget(actions, lineNumber, dialect),
                side: -1,
              }).range(line.from),
            ]);
          } else {
            this.decorations = Decoration.none;
          }
        } catch (error) {
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
    // TEMPORARILY DISABLED: lightbulbPlugin causes Base UI MenuGroupLabel error
    // lightbulbPlugin,
  ];
}
