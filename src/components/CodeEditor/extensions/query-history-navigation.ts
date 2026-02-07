/**
 * Query History Navigation Extension
 *
 * Navigate through query history using Ctrl+Up/Down.
 * - Ctrl+Up: save current buffer, navigate backward through history
 * - Ctrl+Down: navigate forward, restore saved buffer when reaching end
 * - Resets navigation state on user edits
 */

import { keymap, EditorView } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";

interface HistoryNavConfig {
  getHistory: () => string[];
}

/**
 * Create the query history navigation extension.
 * Ctrl+Up navigates backward, Ctrl+Down navigates forward.
 */
export function createQueryHistoryNavExtension(config: HistoryNavConfig): Extension {
  let historyIndex = -1;
  let savedBuffer = "";
  let navigating = false;

  function replaceContent(view: EditorView, text: string) {
    navigating = true;
    // Single dispatch for content + cursor = single undo entry
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    });
    navigating = false;
  }

  const historyKeymap = Prec.high(
    keymap.of([
      {
        key: "Ctrl-ArrowUp",
        mac: "Ctrl-ArrowUp",
        run: (view) => {
          const history = config.getHistory();
          if (history.length === 0) return false;

          // Save current buffer on first navigation
          if (historyIndex === -1) {
            savedBuffer = view.state.doc.toString();
          }

          // Navigate backward
          const newIndex = historyIndex + 1;
          if (newIndex >= history.length) return true; // Already at oldest

          historyIndex = newIndex;
          const entry = history[historyIndex];
          if (entry !== undefined) replaceContent(view, entry);
          return true;
        },
      },
      {
        key: "Ctrl-ArrowDown",
        mac: "Ctrl-ArrowDown",
        run: (view) => {
          if (historyIndex === -1) return false; // Not navigating

          // Navigate forward
          const newIndex = historyIndex - 1;
          if (newIndex < 0) {
            // Restore saved buffer
            historyIndex = -1;
            replaceContent(view, savedBuffer);
            return true;
          }

          const history = config.getHistory();
          historyIndex = newIndex;
          const entry = history[historyIndex];
          if (entry !== undefined) replaceContent(view, entry);
          return true;
        },
      },
    ])
  );

  // Reset navigation state on user edits
  const resetOnEdit = EditorView.updateListener.of((update) => {
    if (update.docChanged && !navigating) {
      historyIndex = -1;
      savedBuffer = "";
    }
  });

  return [historyKeymap, resetOnEdit];
}
