import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { X, Table, FileJson, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataTableRow } from "../types";

interface PreviewPanelProps {
  selectedRows: DataTableRow[];
  columns: Array<{
    id: string;
    name: string;
    dbType: string;
  }>;
  isOpen: boolean;
  onClose: () => void;
  onCopy: (format: "json" | "csv" | "insert") => void;
  className?: string;
}

export const PreviewPanel = memo(function PreviewPanel({
  selectedRows,
  columns,
  isOpen,
  onClose,
  onCopy,
  className,
}: PreviewPanelProps) {
  if (!isOpen || selectedRows.length === 0) return null;

  const isSingleRow = selectedRows.length === 1;

  // Generate table view data
  const tableViewData = useMemo(() => {
    if (selectedRows.length === 0)
      return [] as Array<{
        field: string;
        value: any;
        type: string;
        hasMultipleValues: boolean;
      }>;

    const fields: Array<{
      field: string;
      value: any;
      type: string;
      hasMultipleValues: boolean;
    }> = [];

    columns.forEach((col) => {
      const values = selectedRows.map((row) => row[col.id]);
      const uniqueValues = new Set(values.map((v) => JSON.stringify(v)));
      const hasMultipleValues = uniqueValues.size > 1;

      fields.push({
        field: col.name,
        value: hasMultipleValues ? "Multiple values" : values[0]?.value,
        type: col.dbType,
        hasMultipleValues,
      });
    });

    return fields;
  }, [selectedRows, columns]);

  // Generate JSON view data
  const jsonViewData = useMemo(() => {
    if (selectedRows.length === 1) {
      const row: Record<string, any> = {};
      const first = selectedRows[0];
      if (first) {
        columns.forEach((col) => {
          const cellValue = first[col.id];
          row[col.name] = cellValue?.value ?? null;
        });
      }
      return JSON.stringify(row, null, 2);
    }

    const rows = selectedRows.map((row) => {
      const obj: Record<string, any> = {};
      columns.forEach((col) => {
        const cellValue = row[col.id];
        obj[col.name] = cellValue?.value ?? null;
      });
      return obj;
    });

    return JSON.stringify(rows, null, 2);
  }, [selectedRows, columns]);

  return (
    <div
      className={cn(
        "border-t bg-background",
        "animate-in slide-in-from-bottom-2 duration-200",
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {isSingleRow
              ? "Row Details"
              : `${selectedRows.length} Rows Selected`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy("json")}
            className="h-7"
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy("csv")}
            className="h-7"
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy("insert")}
            className="h-7"
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy INSERT
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="table" className="h-[300px]">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="table" className="gap-1">
            <Table className="h-3 w-3" />
            Table
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1">
            <FileJson className="h-3 w-3" />
            JSON
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="h-full overflow-auto px-4 pb-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-medium text-sm">
                  Field
                </th>
                <th className="text-left py-2 px-3 font-medium text-sm">
                  Value
                </th>
                <th className="text-left py-2 px-3 font-medium text-sm">
                  Type
                </th>
              </tr>
            </thead>
            <tbody>
              {tableViewData.map((field, index) => (
                <tr key={index} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 font-mono text-sm">{field.field}</td>
                  <td
                    className={cn(
                      "py-2 px-3 text-sm",
                      field.hasMultipleValues && "text-muted-foreground italic",
                    )}
                  >
                    {field.value !== null ? String(field.value) : "NULL"}
                  </td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">
                    {field.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="json" className="h-full overflow-auto px-4 pb-4">
          <pre className="font-mono text-xs bg-muted p-3 rounded overflow-auto">
            {jsonViewData}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
});
