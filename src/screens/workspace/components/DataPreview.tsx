import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Copy, Download, FileJson, Table, FileText } from "lucide-react";

interface DataPreviewProps {
  data?: any;
}

export function DataPreview({ data }: DataPreviewProps) {
  // If no data provided, show empty state
  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
        <Table className="h-8 w-8 mb-2" />
        <p className="text-sm">Select a row to preview</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-muted/30">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-medium">Row Preview</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="json" className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none h-9 bg-transparent border-b">
          <TabsTrigger value="json" className="text-xs">
            <FileJson className="h-3 w-3 mr-1.5" />
            JSON
          </TabsTrigger>
          <TabsTrigger value="table" className="text-xs">
            <Table className="h-3 w-3 mr-1.5" />
            Table
          </TabsTrigger>
          <TabsTrigger value="raw" className="text-xs">
            <FileText className="h-3 w-3 mr-1.5" />
            Raw
          </TabsTrigger>
        </TabsList>

        <TabsContent value="json" className="flex-1 m-0">
          <ScrollArea className="h-full">
            <pre className="p-4 text-xs font-mono">
              {JSON.stringify(data, null, 2)}
            </pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="table" className="flex-1 m-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(data).map(([key, value]) => (
                    <tr key={key} className="border-b">
                      <td className="py-2 font-medium text-muted-foreground">
                        {key}
                      </td>
                      <td className="py-2 pl-4">
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="raw" className="flex-1 m-0">
          <ScrollArea className="h-full">
            <div className="p-4 font-mono text-xs">
              {JSON.stringify(data)}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}