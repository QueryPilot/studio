/**
 * Inline Rename Extension
 *
 * Provides inline rename widget for SQL symbols (aliases, CTEs, column aliases).
 * Triggered by F2 key or context menu action.
 */

import { EditorView, Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";
import type { RefactorAction, RefactorResult } from "../languages/sql/refactor-service";

// State effect to show/hide rename widget
const showRenameWidget = StateEffect.define<{
  from: number;
  to: number;
  currentName: string;
  dialect: string;
} | null>();

// Rename widget decoration
class RenameWidget extends WidgetType {
  constructor(
    private currentName: string,
    private from: number,
    private to: number,
    private dialect: string
  ) {
    super();
  }

  eq(other: RenameWidget) {
    return (
      this.currentName === other.currentName &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-rename-widget";
    container.style.cssText = `
      display: inline-block;
      margin-left: 8px;
      vertical-align: baseline;
    `;

    const input = document.createElement("input");
    input.type = "text";
    input.value = this.currentName;
    input.className = "cm-rename-input";
    input.style.cssText = `
      background: hsl(var(--popover));
      border: 1px solid hsl(var(--border));
      border-radius: calc(var(--radius) - 2px);
      padding: 2px 6px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: hsl(var(--popover-foreground));
      outline: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      min-width: 120px;
    `;

    const hint = document.createElement("span");
    hint.className = "cm-rename-hint";
    hint.textContent = "↵ to rename · Esc to cancel";
    hint.style.cssText = `
      margin-left: 8px;
      font-size: 11px;
      color: hsl(var(--muted-foreground));
      white-space: nowrap;
    `;

    container.appendChild(input);
    container.appendChild(hint);

    // Auto-focus and select
    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);

    // Handle Enter key - apply rename
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const newName = input.value.trim();
        if (newName && newName !== this.currentName) {
          await this.applyRename(view, newName);
        } else {
          this.cancel(view);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.cancel(view);
      }
    });

    // Handle blur - cancel rename
    input.addEventListener("blur", () => {
      // Delay to allow click events to process
      setTimeout(() => {
        if (document.activeElement !== input) {
          this.cancel(view);
        }
      }, 100);
    });

    return container;
  }

  private async applyRename(view: EditorView, newName: string) {
    try {
      const sql = view.state.doc.toString();

      // Call backend to apply rename
      const result = await invoke<RefactorResult>("sql_apply_refactor", {
        sql,
        dialect: this.dialect,
        action: {
          kind: "rename",
          symbol_span: { start: this.from, end: this.to },
          new_name: newName,
        },
      });

      // Apply the new SQL
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: result.new_sql,
        },
        effects: showRenameWidget.of(null),
      });

      // Set cursor to the renamed position
      view.dispatch({
        selection: { anchor: result.cursor_position },
      });

      view.focus();
    } catch (error) {
      logger.error("[Rename] Failed to apply:", error);
      // Show error (you could add a toast notification here)
      this.cancel(view);
    }
  }

  private cancel(view: EditorView) {
    view.dispatch({
      effects: showRenameWidget.of(null),
    });
    view.focus();
  }

  ignoreEvent() {
    return false;
  }
}

// State field to manage rename widget
const renameWidgetField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(showRenameWidget)) {
        if (effect.value) {
          const widget = new RenameWidget(
            effect.value.currentName,
            effect.value.from,
            effect.value.to,
            effect.value.dialect
          );
          return Decoration.set([
            Decoration.widget({
              widget,
              side: 1,
            }).range(effect.value.to),
          ]);
        }
        return Decoration.none;
      }
    }

    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Start inline rename at current cursor position
 */
export async function startRename(
  view: EditorView,
  dialect: string
): Promise<boolean> {
  const pos = view.state.selection.main.from;
  const sql = view.state.doc.toString();

  try {
    // Get refactor actions at cursor position
    const actions = await invoke<RefactorAction[]>("sql_get_refactor_actions", {
      sql,
      dialect,
      cursorOffset: pos,
    });

    // Find rename action
    const renameAction = actions.find((a) => a.kind === "rename" && a.enabled);
    if (!renameAction || !renameAction.symbol) {
      return false;
    }

    // Show rename widget
    view.dispatch({
      effects: showRenameWidget.of({
        from: renameAction.span.start,
        to: renameAction.span.end,
        currentName: renameAction.symbol,
        dialect,
      }),
    });

    return true;
  } catch (error) {
    logger.error("[Rename] Failed to get refactor actions:", error);
    return false;
  }
}

/**
 * Create the inline rename extension
 */
export function createInlineRenameExtension(_dialect: string): Extension {
  return [renameWidgetField];
}
