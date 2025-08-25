import { memo } from "react";
import { cn } from "@/lib/utils";
import { MapPin, Map } from "lucide-react";
import type { CellRendererProps } from "../types";

export const GeometryCell = memo(function GeometryCell({
  value,
  isSelected,
  isHovered,
}: CellRendererProps) {
  const geometryValue = value?.value_type === "Geometry" ? value.value : null;

  const getGeometryType = (val: any): string => {
    if (!val) return "Unknown";

    if (typeof val === "object" && val.type) {
      return val.type;
    }

    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (parsed.type) return parsed.type;
      } catch {
        // Try to detect WKT format
        if (val.startsWith("POINT")) return "Point";
        if (val.startsWith("LINESTRING")) return "LineString";
        if (val.startsWith("POLYGON")) return "Polygon";
        if (val.startsWith("MULTIPOINT")) return "MultiPoint";
        if (val.startsWith("MULTILINESTRING")) return "MultiLineString";
        if (val.startsWith("MULTIPOLYGON")) return "MultiPolygon";
        if (val.startsWith("GEOMETRYCOLLECTION")) return "GeometryCollection";
      }
    }

    return "Geometry";
  };

  const formatGeometry = (val: any): string => {
    if (!val) return "";

    if (typeof val === "string") {
      return val.length > 50 ? val.substring(0, 50) + "..." : val;
    }

    if (typeof val === "object") {
      const str = JSON.stringify(val);
      return str.length > 50 ? str.substring(0, 50) + "..." : str;
    }

    return String(val);
  };

  const geometryType = getGeometryType(geometryValue);
  const displayValue = formatGeometry(geometryValue);

  const IconComponent = geometryType === "Point" ? MapPin : Map;

  return (
    <div
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
      )}
      title={`${geometryType}: ${displayValue}`}
    >
      {geometryValue !== null ? (
        <>
          <IconComponent className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 flex flex-col min-w-0">
            <span className="text-xs font-medium">{geometryType}</span>
            <span className="font-mono text-xs truncate text-muted-foreground">
              {displayValue}
            </span>
          </div>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
