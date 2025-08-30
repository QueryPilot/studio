import { memo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";
import type { CellValue } from "@/types/cellValue";

interface CellValuePopupProps {
  isOpen: boolean;
  onClose: () => void;
  value: CellValue | any;
  columnName: string;
}

export const CellValuePopup = memo(function CellValuePopup({
  isOpen,
  onClose,
  value,
  columnName,
}: CellValuePopupProps) {
  const { copy } = useCopy();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const textValue = formatValue(value);
    await copy(textValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }
    return String(val);
  };

  const displayValue = formatValue(value);
  const isJson = typeof value === "object" && value !== null;
  const isLongText = displayValue.length > 100;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="text-base">Column: {columnName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isJson ? "JSON Object" : `Text (${displayValue.length} characters)`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 w-full rounded-md border p-4 bg-muted/30">
          <pre
            className={cn(
              "text-xs whitespace-pre-wrap break-all",
              isJson && "font-mono",
              !isJson && !isLongText && "text-sm"
            )}
          >
            {displayValue}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
});