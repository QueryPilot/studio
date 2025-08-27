/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { memo } from "react";
import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";

// Import individual cell components
import { NullCell } from "./NullCell";
import { IntegerCell, DecimalCell } from "./NumericCells";
import { BooleanCell } from "./BooleanCell";
import { DateCell, DateTimeCell, TimeCell } from "./DateTimeCells";
import { TextCell } from "./TextCell";
import { JsonCell } from "./JsonCell";
import { BinaryCell } from "./BinaryCell";
import { UuidCell } from "./UuidCell";
import { ArrayCell } from "./ArrayCell";
import { GeometryCell, XmlCell, EnumCell } from "./SpecialCells";
import { MoneyCell } from "./MoneyCell";

interface CellValueRendererProps {
  cell: CellValue;
  column?: ColumnMeta;
}

export const CellValueRenderer = memo(function CellValueRenderer({
  cell,
}: CellValueRendererProps) {
  // Handle NULL values
  if (cell.value === null || cell.value === undefined) {
    console.log(`>>>cell.value`, cell);
    const isNumeric = ["Integer", "Decimal", "Money"].includes(cell.value_type);
    return <NullCell isNumeric={isNumeric} />;
  }

  // Render based on value type
  switch (cell.value_type) {
    case "Integer":
      return <IntegerCell value={cell.value as number} />;

    case "Decimal":
      return (
        <DecimalCell
          value={cell.value as number}
          precision={cell.metadata?.precision}
          scale={cell.metadata?.scale}
        />
      );

    case "Boolean":
      return <BooleanCell value={cell.value as boolean} />;

    case "Date":
      return <DateCell value={cell.value as string} />;

    case "DateTime":
      return (
        <DateTimeCell
          value={cell.value as string}
          timezone={cell.metadata?.timezone}
        />
      );

    case "Time":
      return <TimeCell value={cell.value as string} />;

    case "Json":
      return <JsonCell value={cell.value} />;

    case "Binary":
      return <BinaryCell size={cell.byte_size || 0} />;

    case "Uuid":
      return <UuidCell value={cell.value as string} />;

    case "Array":
      return (
        <ArrayCell
          value={cell.value}
          elementType={cell.metadata?.element_type}
        />
      );

    case "Geometry":
      return <GeometryCell value={cell.value} srid={cell.metadata?.srid} />;

    case "Xml":
      return <XmlCell value={cell.value} />;

    case "Enum":
      return (
        <EnumCell value={cell.value} options={cell.metadata?.enum_values} />
      );

    case "Money":
      return (
        <MoneyCell
          value={cell.value as string | number}
          currency={cell.metadata?.currency_symbol}
        />
      );

    case "Text":
    case "Unknown":
    default:
      return <TextCell value={cell.value as string} />;
  }
});
