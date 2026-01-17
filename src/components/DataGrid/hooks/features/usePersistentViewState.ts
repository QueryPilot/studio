import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GridSelection } from "@glideapps/glide-data-grid";
import type { Item, SerializedGridSelection } from "../../types";
import {
  useGridPreferencesHydrated,
  useGridViewState,
} from "../../stores";
import { upsertGridViewState } from "../../stores";
import {
  deserializeGridSelection,
  serializeGridSelection,
} from "../../utils";

interface ScrollOffset {
  x: number;
  y: number;
}

export interface PersistentViewState {
  selection?: GridSelection;
  serializedSelection?: SerializedGridSelection;
  activeCell?: Item | null;
  scrollOffset?: ScrollOffset;
}

export interface UsePersistentViewStateResult {
  hydrated: boolean;
  persistedView: PersistentViewState;
  persistSelection: (selection: GridSelection | undefined) => void;
  persistScrollOffset: (offset: ScrollOffset) => void;
  persistActiveCell: (cell: Item | null | undefined) => void;
  clearViewState: () => void;
}

export function usePersistentViewState(
  gridId: string,
): UsePersistentViewStateResult {
  const hydrated = useGridPreferencesHydrated();
  const viewState = useGridViewState(gridId);
  const lastSelectionRef = useRef<string | null>(null);
  const lastScrollRef = useRef<string | null>(null);

  const persistedView = useMemo<PersistentViewState>(() => {
    if (!viewState) {
      return {};
    }
    return {
      selection: deserializeGridSelection(viewState.selection),
      serializedSelection: viewState.selection,
      activeCell: viewState.activeCell ?? null,
      scrollOffset: viewState.scrollOffset,
    };
  }, [viewState]);

  useEffect(() => {
    const serialized = viewState?.selection
      ? JSON.stringify(viewState.selection)
      : null;
    lastSelectionRef.current = serialized;
    const scroll = viewState?.scrollOffset;
    lastScrollRef.current = scroll ? `${scroll.x},${scroll.y}` : null;
  }, [viewState?.selection, viewState?.scrollOffset]);

  const persistSelection = useCallback(
    (selection: GridSelection | undefined) => {
      const serialized = serializeGridSelection(selection);
      const key = serialized ? JSON.stringify(serialized) : null;
      if (lastSelectionRef.current === key) {
        return;
      }
      lastSelectionRef.current = key;

      upsertGridViewState(gridId, (draft) => {
        draft.selection = serialized;
      });
    },
    [gridId],
  );

  const persistScrollOffset = useCallback(
    (offset: ScrollOffset) => {
      const normalizedX = Math.max(0, Math.round(offset.x));
      const normalizedY = Math.max(0, Math.round(offset.y));
      const key = `${normalizedX},${normalizedY}`;
      if (lastScrollRef.current === key) {
        return;
      }
      lastScrollRef.current = key;
      upsertGridViewState(gridId, (draft) => {
        draft.scrollOffset = { x: normalizedX, y: normalizedY };
      });
    },
    [gridId],
  );

  const persistActiveCell = useCallback(
    (cell: Item | null | undefined) => {
      upsertGridViewState(gridId, (draft) => {
        draft.activeCell = cell ?? null;
      });
    },
    [gridId],
  );

  const clearViewState = useCallback(() => {
    upsertGridViewState(gridId, (draft) => {
      draft.selection = undefined;
      draft.activeCell = null;
      draft.scrollOffset = { x: 0, y: 0 };
    });
  }, [gridId]);

  return {
    hydrated,
    persistedView,
    persistSelection,
    persistScrollOffset,
    persistActiveCell,
    clearViewState,
  };
}
