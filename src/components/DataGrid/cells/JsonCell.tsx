import { memo, useState, useCallback, useMemo } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CellValuePopup } from "../components/CellValuePopup";

interface JsonCellProps {
  value: unknown;
  columnName?: string;
  maxLength?: number;
}

export const JsonCell = memo(function JsonCell({ 
  value, 
  columnName = "JSON",
  maxLength = 50 
}: JsonCellProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  
  const fullJson = useMemo(() => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }, [value]);
  
  const isTruncated = fullJson.length > maxLength;
  const displayText = useMemo(() => 
    isTruncated ? fullJson.slice(0, maxLength) + "..." : fullJson,
    [fullJson, isTruncated, maxLength]
  );
  
  const handleViewClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPopup(true);
  }, []);
  
  return (
    <>
      <div 
        className="relative flex items-center h-full group"
        onMouseEnter={() => isTruncated && setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <pre 
          className="text-xs text-foreground/80 dark:text-foreground/65 bg-muted/50 px-1 py-0.5 rounded font-mono truncate flex-1" 
          title={isTruncated ? "Click view to see full JSON" : undefined}
        >
          {displayText}
        </pre>
        
        {isTruncated && isHovered && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={handleViewClick}
            title="View full JSON"
          >
            <Braces className="h-3 w-3" />
          </Button>
        )}
      </div>
      
      {showPopup && (
        <CellValuePopup
          isOpen={showPopup}
          onClose={() => setShowPopup(false)}
          value={value}
          columnName={columnName}
        />
      )}
    </>
  );
});