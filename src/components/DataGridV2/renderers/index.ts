import { useMemo } from "react";
import type { CustomRenderer, CustomCell } from "@glideapps/glide-data-grid";
import { BooleanCellRenderer } from "./BooleanCell";
import { EnumCellRenderer } from "./EnumCell";
import { NumberCellRenderer } from "./NumberCell";
import { DateTimeCellRenderer } from "./DateTimeCell";
import { DateTimeRangeCellRenderer } from "./DateTimeCell";
import {
  TextMultiLineCellRenderer,
  TextSingleLineCellRenderer,
  TextCellRenderer,
} from "./TextCell";
import { UuidCellRenderer } from "./UuidCell";
import { ReferenceCellRenderer } from "./ReferenceCell";
import { JSONCellRenderer } from "./JSONCell";
import { HStoreCellRenderer } from "./HStoreCell";

type AnyCell = CustomCell<Record<string, unknown>>;

export function useDataGridV2Renderers(): {
  customRenderers: CustomRenderer<AnyCell>[];
} {
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      TextCellRenderer as unknown as CustomRenderer<AnyCell>,
      BooleanCellRenderer as unknown as CustomRenderer<AnyCell>,
      EnumCellRenderer as unknown as CustomRenderer<AnyCell>,
      NumberCellRenderer as unknown as CustomRenderer<AnyCell>,
      DateTimeCellRenderer as unknown as CustomRenderer<AnyCell>,
      DateTimeRangeCellRenderer as unknown as CustomRenderer<AnyCell>,
      JSONCellRenderer as unknown as CustomRenderer<AnyCell>,
      HStoreCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextMultiLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      UuidCellRenderer as unknown as CustomRenderer<AnyCell>,
      ReferenceCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  return { customRenderers };
}
