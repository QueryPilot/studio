import { memo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, FileJson, Table, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopy } from "@/hooks/useCopy";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CellValuePopupProps {
  isOpen: boolean;
  onClose: () => void;
  value: unknown;
  columnName: string;
  rowIndex: number;
}

export const CellValuePopup = memo(function CellValuePopup({
  isOpen,
  onClose,
  value,
  columnName,
  rowIndex,
}: CellValuePopupProps) {
  const { copy } = useCopy();
  const { toast } = useToast();
  const [formattedValue, setFormattedValue] = useState<string>("");
  const [jsonValue, setJsonValue] = useState<string | null>(null);

  useEffect(() => {
    if (value === null) {
      setFormattedValue("NULL");
      setJsonValue(null);
    } else if (value === undefined) {
      setFormattedValue("");
      setJsonValue(null);
    } else if (typeof value === "object") {
      try {
        const json = JSON.stringify(value, null, 2);
        setJsonValue(json);
        setFormattedValue(json);
      } catch {
        setFormattedValue(String(value));
        setJsonValue(null);
      }
    } else {
      setFormattedValue(String(value));
      setJsonValue(null);
    }
  }, [value]);

  const handleCopy = (text: string, format: string) => {
    copy(text);
    toast({
      title: "Copied to clipboard",
      description: `Value copied as ${format}`,
    });
  };

  const getValueType = () => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return "array";
    return typeof value;
  };

  const valueType = getValueType();
  const isJsonType = valueType === "object" || valueType === "array";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{columnName}</span>
            <span className="text-sm text-muted-foreground">
              (Row {rowIndex + 1})
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-muted-foreground">Type:</span>
          <span
            className={cn(
              "text-sm font-mono px-2 py-0.5 rounded",
              valueType === "string" && "bg-green-500/10 text-green-600",
              valueType === "number" && "bg-blue-500/10 text-blue-600",
              valueType === "boolean" && "bg-purple-500/10 text-purple-600",
              valueType === "null" && "bg-gray-500/10 text-gray-600",
              isJsonType && "bg-orange-500/10 text-orange-600",
            )}
          >
            {valueType}
          </span>
          {typeof value === "string" && (
            <span className="text-sm text-muted-foreground">
              ({value.length} characters)
            </span>
          )}
        </div>

        {isJsonType ? (
          <Tabs defaultValue="formatted" className="w-full">
            <div className="flex items-center justify-between mb-2">
              <TabsList>
                <TabsTrigger value="formatted">Formatted</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleCopy(formattedValue, "JSON");
                  }}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy JSON
                </Button>
              </div>
            </div>

            <TabsContent value="formatted" className="mt-0">
              <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                <pre className="font-mono text-sm">{jsonValue}</pre>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="raw" className="mt-0">
              <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                <pre className="font-mono text-sm break-all whitespace-pre-wrap">
                  {formattedValue}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <ScrollArea className="h-[400px] w-full rounded-md border p-4 mb-4">
              <pre
                className={cn(
                  "font-mono text-sm break-all whitespace-pre-wrap",
                  valueType === "null" && "text-muted-foreground italic",
                )}
              >
                {formattedValue}
              </pre>
            </ScrollArea>

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  handleCopy(formattedValue, "text");
                }}
              >
                <Copy className="h-4 w-4 mr-1" />
                Copy
              </Button>

              {typeof value === "string" && value.includes("\n") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleCopy(value.replace(/\n/g, "\\n"), "escaped");
                  }}
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Copy Escaped
                </Button>
              )}

              {typeof value === "string" && value.includes(",") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleCopy(`"${value.replace(/"/g, '""')}"`, "CSV");
                  }}
                >
                  <Table className="h-4 w-4 mr-1" />
                  Copy CSV
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  handleCopy(JSON.stringify(value), "JSON");
                }}
              >
                <FileJson className="h-4 w-4 mr-1" />
                Copy JSON
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
