import { memo, useState, useCallback, useMemo } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CellValuePopup } from "../components/CellValuePopup";

interface TextCellProps {
  value: string;
  columnName?: string;
  maxLength?: number;
}

export const TextCell = memo(function TextCell({ 
  value, 
  columnName = "Text",
  maxLength = 100 
}: TextCellProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  
  const text = String(value);
  const isTruncated = text.length > maxLength;
  const displayText = useMemo(() => 
    isTruncated ? text.slice(0, maxLength) + "..." : text,
    [text, isTruncated, maxLength]
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
        <span 
          className="text-xs text-foreground/80 dark:text-foreground/65 truncate flex-1" 
          title={isTruncated ? text : undefined}
        >
          {displayText}
        </span>
        
        {isTruncated && isHovered && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={handleViewClick}
            title="View full content"
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
      </div>
      
      {showPopup && (
        <CellValuePopup
          isOpen={showPopup}
          onClose={() => setShowPopup(false)}
          value={text}
          columnName={columnName}
        />
      )}
    </>
  );
});