import { editorRegistry } from "@/services/editorRegistry";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import type { TabMetadata } from "@/types/workbench";

function splitEditorId(editorId: string): { panelId: string; tabId: string } | null {
  const idx = editorId.indexOf(":");
  if (idx <= 0 || idx === editorId.length - 1) return null;
  return { panelId: editorId.slice(0, idx), tabId: editorId.slice(idx + 1) };
}

/**
 * Inserts SQL at the cursor (or replaces selection) in the focused query editor
 * and syncs workbench + tab query state.
 *
 * @returns whether a focused SQL editor accepted the insert
 */
export function insertSqlIntoFocusedEditor(sql: string): boolean {
  const focusedEditor = editorRegistry.getFocusedEditor();
  if (!focusedEditor) return false;

  const ref = focusedEditor.getRef();
  if (!ref) return false;

  ref.replaceSelection(sql);
  ref.focus();

  const split = splitEditorId(focusedEditor.id);
  if (split) {
    const workbench = useWorkbenchStore.getState();
    const panel = workbench.panelContents.get(split.panelId);
    const metadata: TabMetadata = panel?.metadata?.[split.tabId] ?? {};
    const updatedValue = ref.getValue();

    workbench.updateTabMetadata(split.panelId, split.tabId, { sql: updatedValue });

    useTabStateStore.getState().setQueryState(
      split.tabId,
      { query: updatedValue },
      {
        connectionId:
          typeof focusedEditor.connectionId === "string" ? focusedEditor.connectionId : "",
        database:
          typeof focusedEditor.database === "string"
            ? focusedEditor.database
            : (typeof metadata.database === "string" ? metadata.database : ""),
        schema:
          typeof focusedEditor.schema === "string"
            ? focusedEditor.schema
            : (typeof metadata.schema === "string" ? metadata.schema : "public"),
      },
    );
  }

  return true;
}
