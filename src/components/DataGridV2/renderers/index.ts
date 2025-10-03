import { useMemo } from "react";
import type { CustomRenderer, CustomCell } from "@glideapps/glide-data-grid";
import { TextCellRenderer } from "./TextCellRenderer";
import BooleanCellRenderer from "./BooleanCellRenderer";
import EnumCellRenderer from "./EnumCellRenderer";
import DateTimeCellRenderer from "./DateTimeCellRenderer";

type AnyCell = CustomCell<Record<string, unknown>>;

export function useDataGridV2Renderers(): {
  customRenderers: CustomRenderer<AnyCell>[];
} {
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      // V2 renderers - clean implementation without V1 baggage
      TextCellRenderer as unknown as CustomRenderer<AnyCell>,
      BooleanCellRenderer as unknown as CustomRenderer<AnyCell>,
      EnumCellRenderer as unknown as CustomRenderer<AnyCell>,
      DateTimeCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  return { customRenderers };
}
