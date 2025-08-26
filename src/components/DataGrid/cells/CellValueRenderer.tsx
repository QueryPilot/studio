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
  value: CellValue;
  column?: ColumnMeta;
}

export const CellValueRenderer = memo(function CellValueRenderer({
  value,
}: CellValueRendererProps) {
  // Handle NULL values
  if (value.value === null || value.value === undefined) {
    const isNumeric = value.value_type === "Integer" || value.value_type === "Decimal";
    return <NullCell isNumeric={isNumeric} />;
  }

  // Render based on value type
  switch (value.value_type) {
    case "Integer":
      return <IntegerCell value={value.value as number} />;

    case "Decimal":
      return (
        <DecimalCell
          value={value.value as number}
          precision={value.metadata?.precision}
          scale={value.metadata?.scale}
        />
      );

    case "Boolean":
      return <BooleanCell value={value.value as boolean} />;

    case "Date":
      return <DateCell value={value.value as string} />;

    case "DateTime":
      return <DateTimeCell value={value.value as string} timezone={value.metadata?.timezone} />;

    case "Time":
      return <TimeCell value={value.value as string} />;

    case "Json":
      return <JsonCell value={value.value} />;

    case "Binary":
      return <BinaryCell size={value.byte_size || 0} />;

    case "Uuid":
      return <UuidCell value={value.value as string} />;

    case "Array":
      return <ArrayCell value={value.value} elementType={value.metadata?.element_type} />;

    case "Geometry":
      return <GeometryCell value={value.value} srid={value.metadata?.srid} />;

    case "Xml":
      return <XmlCell value={value.value} />;

    case "Enum":
      return <EnumCell value={value.value} options={value.metadata?.enum_values} />;
    
    case "Money":
      return <MoneyCell value={value.value as string | number} currency={value.metadata?.currency} />;

    case "Text":
    case "Unknown":
    default:
      return <TextCell value={value.value as string} />;
  }
});