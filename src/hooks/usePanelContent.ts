import { useCallback } from "react";
import useWorkbenchStore from "@/stores/workbenchStore";
import type { PanelContent } from "@/types/workbench";

/**
 * Subscribe to a single panel's content without re-rendering when other panels change.
 * Uses reference equality on the PanelContent object itself.
 *
 * Note: This works because workbenchStore mutates only the specific PanelContent
 * object that changed — other panels' objects keep the same reference.
 */
export function usePanelContent(panelId: string): PanelContent | undefined {
  return useWorkbenchStore(
    useCallback(
      (state: { panelContents: Map<string, PanelContent> }) =>
        state.panelContents.get(panelId),
      [panelId],
    ),
  );
}
