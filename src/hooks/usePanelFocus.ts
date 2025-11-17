import { useEffect, useMemo } from "react";
import type { RefObject } from "react";

import {
  panelFocusManager,
  type PanelFocusHandle,
} from "@/services/panelFocusManager";

interface FocusRegistrationOptions {
  priority?: number;
  id?: string;
}

export function usePanelFocusRoot(
  panelId: string,
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!panelId) return;
    return panelFocusManager.registerPanelRoot(panelId, () => ref.current);
  }, [panelId, ref]);
}

export function usePanelDefaultFocus(
  panelId: string | undefined,
  getHandle: () => PanelFocusHandle | null | undefined,
  options?: FocusRegistrationOptions,
): void {
  const memoizedOptions = useMemo(
    () => ({
      priority: options?.priority ?? 0,
      id: options?.id,
    }),
    [options?.id, options?.priority],
  );

  useEffect(() => {
    if (!panelId) return;
    return panelFocusManager.registerDefaultTarget(
      panelId,
      getHandle,
      memoizedOptions,
    );
  }, [panelId, getHandle, memoizedOptions]);
}

