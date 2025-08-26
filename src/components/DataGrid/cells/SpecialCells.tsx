import { memo } from "react";
import { ChevronDown } from "lucide-react";

interface GeometryCellProps {
  value: unknown;
  srid?: number;
}

export const GeometryCell = memo(function GeometryCell({ srid }: GeometryCellProps) {
  return (
    <span className="text-xs font-mono text-muted-foreground">
      Geometry {srid && `(SRID: ${srid})`}
    </span>
  );
});

interface XmlCellProps {
  value: unknown;
}

export const XmlCell = memo(function XmlCell({ value }: XmlCellProps) {
  const text = String(value);
  return (
    <pre 
      className="text-xs bg-muted/50 px-1 py-0.5 rounded font-mono truncate block" 
      title={text}
    >
      {text}
    </pre>
  );
});

interface EnumCellProps {
  value: unknown;
  options?: string[];
}

export const EnumCell = memo(function EnumCell({ value }: EnumCellProps) {
  return (
    <div className="flex items-center justify-between text-xs text-foreground/80 dark:text-foreground/65">
      <span className="truncate">{String(value)}</span>
      <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0 text-muted-foreground" />
    </div>
  );
});