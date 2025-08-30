import { memo, useState, useCallback, useMemo } from "react";
import { Brackets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CellValuePopup } from "../components/CellValuePopup";

interface ArrayCellProps {
  value: unknown;
  elementType?: string;
  columnName?: string;
  maxLength?: number;
}

export const ArrayCell = memo(function ArrayCell({
  value,
  columnName = "Array",
  maxLength = 60,
}: ArrayCellProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const items = Array.isArray(value) ? value : [];

  const fullValue = useMemo(() => {
    // Format array in PostgreSQL style with curly braces
    if (items.length === 0) return "{}";

    // Format array values with proper spacing
    const formattedItems = items.map((item) => {
      // Handle NULL values in arrays
      if (item === null || item === undefined) {
        return "NULL";
      }
      // Handle strings with quotes if they contain special characters
      if (typeof item === "string") {
        // Check if string needs quotes (contains spaces, commas, braces, etc.)
        if (
          item.includes(",") ||
          item.includes(" ") ||
          item.includes("{") ||
          item.includes("}")
        ) {
          return `"${item.replace(/"/g, '\\"')}"`;
        }
        return item;
      }
      return String(item);
    });

    return `{${formattedItems.join(",")}}`;
  }, [items]);

  const isTruncated = fullValue.length > maxLength;
  const displayValue = useMemo(() => {
    if (!isTruncated) return fullValue;

    // Try to truncate at a comma for cleaner display
    const truncated = fullValue.slice(0, maxLength);
    const lastComma = truncated.lastIndexOf(",");
    if (lastComma > maxLength - 10) {
      return truncated.slice(0, lastComma) + ",...}";
    }
    return truncated + "...";
  }, [fullValue, isTruncated, maxLength]);

  const handleViewClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPopup(true);
  }, []);

  if (items.length === 0) {
    return (
      <span className="text-xs text-foreground/80 dark:text-foreground/65 font-mono">
        {}
      </span>
    );
  }

  return (
    <>
      <div
        className="relative flex items-center h-full group"
        onMouseEnter={() => isTruncated && setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
        }}
      >
        <span
          className="text-xs text-foreground/80 dark:text-foreground/65 font-mono truncate flex-1"
          title={isTruncated ? `Array[${items.length}]` : fullValue}
        >
          {displayValue}
        </span>

        {isTruncated && isHovered && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={handleViewClick}
            title="View full array"
          >
            <Brackets className="h-3 w-3" />
          </Button>
        )}
      </div>

      {showPopup && (
        <CellValuePopup
          isOpen={showPopup}
          onClose={() => {
            setShowPopup(false);
          }}
          value={value}
          columnName={columnName}
        />
      )}
    </>
  );
});
