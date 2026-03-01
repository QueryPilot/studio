import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createIndexedDbStorage } from "@/components/DataGrid/stores/indexedDbStorage";

export type NumericStatKey =
  | "sum"
  | "avg"
  | "median"
  | "min"
  | "max"
  | "count"
  | "unique"
  | "selected"
  | "null";
export type NonNumericStatKey = "count" | "unique" | "selected" | "null";

const DEFAULT_NUMERIC_STATS: NumericStatKey[] = ["sum", "avg", "max"];
const DEFAULT_NON_NUMERIC_STATS: NonNumericStatKey[] = [
  "selected",
  "count",
  "unique",
];

interface SelectionStatsPreferencesState {
  enabledNumericStats: NumericStatKey[];
  enabledNonNumericStats: NonNumericStatKey[];
  isExpanded: boolean;
  toggleNumericStat: (stat: NumericStatKey) => void;
  toggleNonNumericStat: (stat: NonNumericStatKey) => void;
  cycleNumericStat: (from: NumericStatKey, to: NumericStatKey) => void;
  setExpanded: (expanded: boolean) => void;
  resetToDefaults: () => void;
}

const storage = createJSONStorage(() =>
  createIndexedDbStorage("selection-stats-preferences"),
);

export const useSelectionStatsPreferencesStore =
  create<SelectionStatsPreferencesState>()(
    devtools(
      persist(
        immer((set) => ({
          enabledNumericStats: [...DEFAULT_NUMERIC_STATS],
          enabledNonNumericStats: [...DEFAULT_NON_NUMERIC_STATS],
          isExpanded: true,

          toggleNumericStat: (stat) => {
            set(
              (state) => {
                const idx = state.enabledNumericStats.indexOf(stat);
                if (idx >= 0) {
                  if (state.enabledNumericStats.length > 1) {
                    state.enabledNumericStats.splice(idx, 1);
                  }
                } else {
                  state.enabledNumericStats.push(stat);
                }
              },
              false,
              "selectionStats/toggleNumericStat",
            );
          },

          toggleNonNumericStat: (stat) => {
            set(
              (state) => {
                const idx = state.enabledNonNumericStats.indexOf(stat);
                if (idx >= 0) {
                  if (state.enabledNonNumericStats.length > 1) {
                    state.enabledNonNumericStats.splice(idx, 1);
                  }
                } else {
                  state.enabledNonNumericStats.push(stat);
                }
              },
              false,
              "selectionStats/toggleNonNumericStat",
            );
          },

          cycleNumericStat: (from, to) => {
            set(
              (state) => {
                const fromIdx = state.enabledNumericStats.indexOf(from);
                if (!state.enabledNumericStats.includes(to)) {
                  if (fromIdx >= 0) {
                    state.enabledNumericStats[fromIdx] = to;
                  } else {
                    state.enabledNumericStats.push(to);
                  }
                } else {
                  if (fromIdx >= 0 && state.enabledNumericStats.length > 1) {
                    state.enabledNumericStats.splice(fromIdx, 1);
                  }
                }
              },
              false,
              "selectionStats/cycleNumericStat",
            );
          },

          setExpanded: (expanded) => {
            set(
              (state) => {
                state.isExpanded = expanded;
              },
              false,
              "selectionStats/setExpanded",
            );
          },

          resetToDefaults: () => {
            set(
              (state) => {
                state.enabledNumericStats = [...DEFAULT_NUMERIC_STATS];
                state.enabledNonNumericStats = [...DEFAULT_NON_NUMERIC_STATS];
                state.isExpanded = true;
              },
              false,
              "selectionStats/resetToDefaults",
            );
          },
        })),
        {
          name: "selection-stats-preferences",
          storage,
          version: 1,
          partialize: (state) => ({
            enabledNumericStats: state.enabledNumericStats,
            enabledNonNumericStats: state.enabledNonNumericStats,
            isExpanded: state.isExpanded,
          }),
        },
      ),
    ),
  );
