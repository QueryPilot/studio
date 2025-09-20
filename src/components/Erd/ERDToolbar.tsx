import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LayoutPanelTop, CodeXml, SplitSquareVertical } from "lucide-react";

type ErdMode = "visual" | "code" | "split";

interface ERDToolbarProps {
  mode: ErdMode;
  onModeChange: (mode: ErdMode) => void;
  onCreateView?: () => void;
  onExport?: () => void;
  onRefresh?: () => void;
  schemas?: string[];
  selectedSchema?: string;
  onSchemaChange?: (schema: string) => void;
}

export const ERDToolbar: React.FC<ERDToolbarProps> = ({
  mode,
  onModeChange,
  onCreateView,
  onExport,
  onRefresh,
  schemas,
  selectedSchema,
  onSchemaChange,
}) => {
  return (
    <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
      <Tabs
        value={mode}
        onValueChange={(value) => {
          onModeChange(value as ErdMode);
        }}
      >
        <TabsList className="grid grid-cols-3 h-8">
          <TabsTrigger value="visual" className="flex items-center gap-1 text-xs">
            <LayoutPanelTop className="h-3 w-3" />
            Visual
          </TabsTrigger>
          <TabsTrigger value="code" className="flex items-center gap-1 text-xs">
            <CodeXml className="h-3 w-3" />
            Code
          </TabsTrigger>
          <TabsTrigger value="split" className="flex items-center gap-1 text-xs">
            <SplitSquareVertical className="h-3 w-3" />
            Split
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-2">
        {schemas && schemas.length > 0 && onSchemaChange ? (
          <Select value={selectedSchema} onValueChange={onSchemaChange}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue placeholder="Select schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((schemaOption) => (
                <SelectItem key={schemaOption} value={schemaOption}>
                  {schemaOption}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            onCreateView?.();
          }}
        >
          New View
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            onRefresh?.();
          }}
        >
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            onExport?.();
          }}
        >
          Export
        </Button>
      </div>
    </div>
  );
};
