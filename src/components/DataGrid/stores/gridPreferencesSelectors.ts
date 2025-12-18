import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridColumnsState, GridRowModel, GridViewState } from "../types";
import { useGridPreferencesStore } from "./gridPreferencesStore";

export const useGridPreferences = (gridId: string | null | undefined) =>
  useGridPreferencesStore(
    useCallback(
      (state) => (gridId ? state.preferences[gridId] : undefined),
      [gridId],
    ),
  );

export const useGridPreferencesHydrated = (): boolean => {
  const [hydrated, setHydrated] = useState(
    useGridPreferencesStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) return;
    const unsub = useGridPreferencesStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return () => {
      unsub?.();
    };
  }, [hydrated]);

  return hydrated;
};

export const useGridColumnsState = (
  gridId: string,
): GridColumnsState | undefined => {
  const prefs = useGridPreferences(gridId);
  return useMemo(() => prefs?.columns, [prefs]);
};

export const useGridViewState = (
  gridId: string,
): GridViewState | undefined => {
  const prefs = useGridPreferences(gridId);
  return useMemo(() => prefs?.view, [prefs]);
};

export const upsertGridColumnsState = (
  gridId: string,
  updater: (draft: GridColumnsState) => void,
) => {
  useGridPreferencesStore.getState().updateColumns(gridId, updater);
};

export const upsertGridViewState = (
  gridId: string,
  updater: (draft: GridViewState) => void,
) => {
  useGridPreferencesStore.getState().updateView(gridId, updater);
};

export const setGridDraftRow = (
  gridId: string,
  key: string,
  row: GridRowModel | undefined,
) => {
  useGridPreferencesStore.getState().setDraftRow(gridId, key, row);
};

export const clearGridPreferences = (gridId: string) => {
  useGridPreferencesStore.getState().reset(gridId);
};

export const clearAllGridPreferences = () => {
  useGridPreferencesStore.getState().resetAll();
};
