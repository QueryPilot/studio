import { create } from "zustand";

interface UIState {
  selectedRowCount: number;
  setSelectedRowCount: (count: number) => void;
  totalRowCount: number;
  setTotalRowCount: (count: number) => void;
  estimatedRowCount: number | null;
  setEstimatedRowCount: (count: number | null) => void;
  isLoadingData: boolean;
  setIsLoadingData: (loading: boolean) => void;
  currentTableName: string | null;
  setCurrentTableName: (name: string | null) => void;
  selectedSchema: string;
  setSelectedSchema: (schema: string) => void;
  availableSchemas: string[];
  setAvailableSchemas: (schemas: string[]) => void;
  queryTime: number | null;
  setQueryTime: (time: number | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedRowCount: 0,
  setSelectedRowCount: (count) => set({ selectedRowCount: count }),
  totalRowCount: 0,
  setTotalRowCount: (count) => set({ totalRowCount: count }),
  estimatedRowCount: null,
  setEstimatedRowCount: (count) => set({ estimatedRowCount: count }),
  isLoadingData: false,
  setIsLoadingData: (loading) => set({ isLoadingData: loading }),
  currentTableName: null,
  setCurrentTableName: (name) => set({ currentTableName: name }),
  selectedSchema: "public",
  setSelectedSchema: (schema) => set({ selectedSchema: schema }),
  availableSchemas: [],
  setAvailableSchemas: (schemas) => set({ availableSchemas: schemas }),
  queryTime: null,
  setQueryTime: (time) => set({ queryTime: time }),
}));