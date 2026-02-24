import { create } from "zustand";

interface PanelFocusStore {
  focusedPanelId: string | null;
  focusPanel: (panelId: string) => void;
  clearFocus: () => void;
}

export const usePanelFocusStore = create<PanelFocusStore>()((set, get) => ({
  focusedPanelId: null,

  focusPanel: (panelId) => {
    if (get().focusedPanelId === panelId) return;
    set({ focusedPanelId: panelId });
  },

  clearFocus: () => {
    set({ focusedPanelId: null });
  },
}));
