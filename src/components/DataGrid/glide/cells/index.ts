import { useMemo } from "react";
import type { CustomRenderer, CustomCell } from "@glideapps/glide-data-grid";
import { BooleanCell } from "./BooleanCell";
import { EnumCell } from "./EnumCell";
import { DateCell } from "./DateCell";
import { DateTimeCell } from "./DateTimeCell.tsx";
import { TimeCell } from "./TimeCell.tsx";
import { JsonCell } from "./JsonCell";
import { LookupCell } from "./LookupCell";
import { NumberCell } from "./NumberCell";
import { MoneyCell } from "./MoneyCell";
import { UuidCell } from "./UuidCell";
import { ArrayCell } from "./ArrayCell";
import { BinaryCell } from "./BinaryCell";

// Placeholder stubs – implement real draw/provideEditor later
// re-exported from concrete cell files

export const NULL_TEXT = "NULL";

export function getNullFont(base: string) {
  return `italic ${base}`;
}

export function getNullColor(theme: { textLight: string }) {
  return theme.textLight;
}

type AnyCell = CustomCell<Record<string, unknown>>;
export function useDatabaseCells(): {
  customRenderers: CustomRenderer<AnyCell>[];
} {
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      BooleanCell as unknown as CustomRenderer<AnyCell>,
      DateCell as unknown as CustomRenderer<AnyCell>,
      DateTimeCell as unknown as CustomRenderer<AnyCell>,
      TimeCell as unknown as CustomRenderer<AnyCell>,
      JsonCell as unknown as CustomRenderer<AnyCell>,
      LookupCell as unknown as CustomRenderer<AnyCell>,
      NumberCell as unknown as CustomRenderer<AnyCell>,
      MoneyCell as unknown as CustomRenderer<AnyCell>,
      UuidCell as unknown as CustomRenderer<AnyCell>,
      ArrayCell as unknown as CustomRenderer<AnyCell>,
      BinaryCell as unknown as CustomRenderer<AnyCell>,
      EnumCell as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );
  return { customRenderers };
}
