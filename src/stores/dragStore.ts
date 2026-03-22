import { create } from "zustand";

export type DragSourceKind = "tab" | "sidebar" | null;

interface DragState {
  isDragActive: boolean;
  sourcePanelId: string | null;
  draggedTabId: string | null;
  dragSourceKind: DragSourceKind;
  setDrag: (tabId: string, panelId: string, sourceKind: Exclude<DragSourceKind, null>) => void;
  clearDrag: () => void;
}

export const useDragStore = create<DragState>((set) => ({
  isDragActive: false,
  sourcePanelId: null,
  draggedTabId: null,
  dragSourceKind: null,
  setDrag: (tabId, panelId, sourceKind) => {
    set({
      isDragActive: true,
      sourcePanelId: panelId,
      draggedTabId: tabId,
      dragSourceKind: sourceKind,
    });
  },
  clearDrag: () => {
    set({
      isDragActive: false,
      sourcePanelId: null,
      draggedTabId: null,
      dragSourceKind: null,
    });
  },
}));
