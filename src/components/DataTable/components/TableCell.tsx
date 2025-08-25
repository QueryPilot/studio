/**
 * Generic TableCell wrapper that renders appropriate cell type based on CellValue
 */
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { type CellRendererProps } from "../types";
import {
  StringCell,
  NumberCell,
  DateCell,
  BooleanCell,
  JsonCell,
  UuidCell,
  BinaryCell,
  ArrayCell,
  GeometryCell,
  XmlCell,
  EnumCell,
  UnknownCell,
} from "../cells";

interface TableCellProps extends CellRendererProps {
  className?: string;
}

const TableCell = memo(function TableCell({
  value,
  rowId,
  columnId,
  isSelected,
  isEditing,
  isHovered,
  onEdit,
  onCopy,
  onStartEdit,
  onCancelEdit,
  column,
  rowIndex,
  columnIndex,
  className,
}: TableCellProps) {
  const [isLocalHovered, setIsLocalHovered] = useState(false);
  const effectiveHovered = isHovered || isLocalHovered;

  // Get cell renderer based on value type
  const getCellRenderer = () => {
    const props: CellRendererProps = {
      value,
      rowId,
      columnId,
      isSelected,
      isEditing,
      isHovered: effectiveHovered,
      onEdit,
      onCopy,
      onStartEdit,
      onCancelEdit,
      column,
      rowIndex,
      columnIndex,
    };

    if (!value) {
      return <UnknownCell {...props} />;
    }

    // Backward-compat: some backends may still send `type` instead of `value_type`
    const valueType = (value as any).value_type ?? (value as any).type;

    switch (valueType) {
      case "Text":
        return <StringCell {...props} />;
      case "Integer":
      case "Decimal":
        return <NumberCell {...props} />;
      case "Date":
      case "DateTime":
      case "Time":
        return <DateCell {...props} />;
      case "Boolean":
        return <BooleanCell {...props} />;
      case "Json":
        return <JsonCell {...props} />;
      case "Uuid":
        return <UuidCell {...props} />;
      case "Binary":
        return <BinaryCell {...props} />;
      case "Array":
        return <ArrayCell {...props} />;
      case "Geometry":
        return <GeometryCell {...props} />;
      case "Xml":
        return <XmlCell {...props} />;
      case "Enum":
        return <EnumCell {...props} />;
      default:
        return <UnknownCell {...props} />;
    }
  };

  return (
    <div
      className={cn("group relative h-full min-h-[32px]", className)}
      onMouseEnter={() => setIsLocalHovered(true)}
      onMouseLeave={() => setIsLocalHovered(false)}
      data-cell-id={`${rowId}:${columnId}`}
    >
      {getCellRenderer()}
    </div>
  );
});

export { TableCell };
