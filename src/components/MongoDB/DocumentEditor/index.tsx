import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconCheck, IconX, IconCode } from "@tabler/icons-react";
import { toast } from "sonner";
import { TreeView } from "./TreeView";
import { Breadcrumb } from "./Breadcrumb";
import { Textarea } from "@/components/ui/textarea";

interface DocumentEditorProps {
  document: Record<string, unknown>;
  isOpen: boolean;
  onClose: () => void;
  onSave: (doc: Record<string, unknown>) => Promise<void>;
}

export function DocumentEditor({
  document,
  isOpen,
  onClose,
  onSave,
}: DocumentEditorProps) {
  const [json, setJson] = useState("");
  const [parsedData, setParsedData] = useState<Record<string, unknown> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "raw">("tree");
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  const isNew = !document._id;

  useEffect(() => {
    setJson(JSON.stringify(document, null, 2));
    setParsedData(document);
    setParseError(null);
  }, [document]);

  const handleJsonChange = (value: string) => {
    setJson(value);
    try {
      const parsed = JSON.parse(value);
      setParsedData(parsed);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
      setParsedData(null); 
    }
  };

  const handleSave = async () => {
    try {
      const dataToSave = parsedData || JSON.parse(json);
      setIsSaving(true);
      await onSave(dataToSave);
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error("Invalid JSON");
      } else {
        toast.error(`Save failed: ${err}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>{isNew ? "New Document" : "Edit Document"}</span>
            <div className="flex gap-2">
              <Button
                variant={viewMode === "raw" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode(viewMode === "tree" ? "raw" : "tree")}
                title="Toggle Raw JSON"
              >
                <IconCode className="h-4 w-4" />
              </Button>
            </div>
          </SheetTitle>
          {viewMode === "tree" && (
            <div className="py-2 border-b">
              <Breadcrumb path={currentPath} onNavigate={setCurrentPath} />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {viewMode === "raw" ? (
            <div className="h-full flex flex-col">
              <Textarea
                value={json}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="flex-1 font-mono text-sm resize-none"
                placeholder='{"field": "value"}'
              />
              {parseError && (
                <p className="text-xs text-destructive mt-2">{parseError}</p>
              )}
            </div>
          ) : (
            <div className="h-full">
              {parsedData ? (
                <TreeView 
                  data={parsedData} 
                  path={[]}
                />
              ) : (
                <div className="text-destructive p-4 border border-destructive/20 rounded bg-destructive/10">
                  Invalid JSON. Switch to Raw mode to fix.
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            <IconX className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !!parseError}
          >
            <IconCheck className="h-4 w-4 mr-1" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
