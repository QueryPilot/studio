import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { startCompletion } from "./index";

interface TriggerConfig {
  immediate: boolean;
}

export function createSmartTriggers(): Extension {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    const shouldTrigger = detectTriggerContext(update as any);
    if (shouldTrigger) {
      debounceTimer = setTimeout(
        () => startCompletion(update.view),
        shouldTrigger.immediate ? 0 : 150,
      );
    }
  });
}

function detectTriggerContext(update: any): TriggerConfig | null {
  const pos = update.state.selection.main.head;
  const line = update.state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  // Trigger immediately on dot, and softly after FROM/JOIN/SELECT token with short debounce
  if (textBefore.endsWith(".")) return { immediate: true };
  if (/\b(FROM|JOIN|SELECT)\s+\w*$/.test(textBefore))
    return { immediate: false };
  return null;
}
