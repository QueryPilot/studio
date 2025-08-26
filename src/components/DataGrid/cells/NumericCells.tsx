import { memo } from "react";
import { formatInteger, formatDecimal } from "./formatters";

interface IntegerCellProps {
  value: number;
}

export const IntegerCell = memo(function IntegerCell({ value }: IntegerCellProps) {
  return <span className="text-xs text-foreground/80 dark:text-foreground/65 tabular-nums block text-right">{formatInteger(value)}</span>;
});

interface DecimalCellProps {
  value: number;
  precision?: number;
  scale?: number;
}

export const DecimalCell = memo(function DecimalCell({ value, scale }: DecimalCellProps) {
  return <span className="text-xs text-foreground/80 dark:text-foreground/65 tabular-nums block text-right">{formatDecimal(value, scale)}</span>;
});