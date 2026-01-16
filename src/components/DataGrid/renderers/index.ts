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
import { ExpandableCellRenderer } from "./ExpandableCell";
// New renderers for extended type support
import { InetCellRenderer, MacAddrCellRenderer } from "./NetworkCell";
import { RangeCellRenderer } from "./RangeCell";
import { IntervalCellRenderer } from "./IntervalCell";
import { XmlCellRenderer } from "./XmlCell";
import { BitCellRenderer } from "./BitCell";
import { ByteaCellRenderer } from "./ByteaCell";
import { GeometryCellRenderer } from "./GeometryCell";

type AnyCell = CustomCell<Record<string, unknown>>;

export function useDataGridRenderers(): {
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
      ExpandableCellRenderer as unknown as CustomRenderer<AnyCell>,
      // New renderers for extended type support
      InetCellRenderer as unknown as CustomRenderer<AnyCell>,
      MacAddrCellRenderer as unknown as CustomRenderer<AnyCell>,
      RangeCellRenderer as unknown as CustomRenderer<AnyCell>,
      IntervalCellRenderer as unknown as CustomRenderer<AnyCell>,
      XmlCellRenderer as unknown as CustomRenderer<AnyCell>,
      BitCellRenderer as unknown as CustomRenderer<AnyCell>,
      ByteaCellRenderer as unknown as CustomRenderer<AnyCell>,
      GeometryCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  return { customRenderers };
}
