import { create } from "zustand";

interface UIState {
  selectedRowCount: number;
  setSelectedRowCount: (count: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedRowCount: 0,
  setSelectedRowCount: (count) => set({ selectedRowCount: count }),
}));