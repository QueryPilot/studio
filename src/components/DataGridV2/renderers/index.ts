import { useMemo } from "react";
import type { CustomRenderer, CustomCell } from "@glideapps/glide-data-grid";
import { TextCellRenderer } from "./TextCellRenderer";

type AnyCell = CustomCell<Record<string, unknown>>;

export function useDataGridV2Renderers(): {
  customRenderers: CustomRenderer<AnyCell>[];
} {
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      // V2 renderers - clean implementation without V1 baggage
      TextCellRenderer as unknown as CustomRenderer<AnyCell>,
      // TODO: Add more V2 custom renderers as needed
    ],
    [],
  );

  return { customRenderers };
}