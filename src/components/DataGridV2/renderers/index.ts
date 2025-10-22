import { useMemo } from "react";
import type { CustomRenderer, CustomCell } from "@glideapps/glide-data-grid";
import { TextCellRenderer } from "./TextCellRenderer";
import BooleanCellRenderer from "./BooleanCellRenderer";
import EnumCellRenderer from "./EnumCellRenderer";
import DateTimeCellRenderer from "./DateTimeCellRenderer";
import DateTimeRangeCellRenderer from "./DateTimeRangeCellRenderer";
import TextSingleLineCellRenderer from "./TextSingleLineCellRenderer";
import TextMultiLineCellRenderer from "./TextMultiLineCellRenderer";
import UuidCellRenderer from "./UuidCellRenderer";
import ReferenceCellRenderer from "./ReferenceCellRenderer";
import JSONCellRenderer from "./JSONCellRenderer";

type AnyCell = CustomCell<Record<string, unknown>>;

export function useDataGridV2Renderers(): {
  customRenderers: CustomRenderer<AnyCell>[];
} {
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      TextCellRenderer as unknown as CustomRenderer<AnyCell>,
      BooleanCellRenderer as unknown as CustomRenderer<AnyCell>,
      EnumCellRenderer as unknown as CustomRenderer<AnyCell>,
      DateTimeCellRenderer as unknown as CustomRenderer<AnyCell>,
      DateTimeRangeCellRenderer as unknown as CustomRenderer<AnyCell>,
      JSONCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextMultiLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      UuidCellRenderer as unknown as CustomRenderer<AnyCell>,
      ReferenceCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  return { customRenderers };
}
