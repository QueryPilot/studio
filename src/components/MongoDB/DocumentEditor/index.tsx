/**
 * MongoDB Document Editor Component
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  IconCheck,
  IconX,
  IconCode,
  IconBinaryTree2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { ViewModeToggle } from "@/components/DataGrid/components/ViewModeToggle";
import { BreadcrumbNav } from "@/components/DataGrid/components/BreadcrumbNav";
import { TreeView } from "./TreeView";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  const [currentDocument, setCurrentDocument] = useState<Record<string, JsonValue>>({});
  const [json, setJson] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "json">("tree");
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  const isNew = !document._id;

  useEffect(() => {
    const doc = document as Record<string, JsonValue>;
    setCurrentDocument(doc);
    setJson(JSON.stringify(doc, null, 2));
    setParseError(null);
    setCurrentPath([]);
  }, [document]);

  useEffect(() => {
    if (viewMode === "json") {
      setJson(JSON.stringify(currentDocument, null, 2));
    }
  }, [viewMode, currentDocument]);

  const handleJsonChange = useCallback((value: string) => {
    setJson(value);
    try {
      const parsed = JSON.parse(value);
      setCurrentDocument(parsed);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }, []);

  const handleNavigate = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  const handleValueChange = useCallback(
    (path: string[], newValue: JsonValue) => {
      if (path.length === 0) return;
      
      setCurrentDocument((prev) => {
        const updated = JSON.parse(JSON.stringify(prev)) as Record<string, JsonValue>;
        let current: JsonValue = updated;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i] as string;
          if (current === null || typeof current !== "object") break;
          if (Array.isArray(current)) {
            current = current[parseInt(key, 10)] as JsonValue;
          } else {
            current = current[key] as JsonValue;
          }
        }
        if (current === null || typeof current !== "object") return prev;
        const lastKey = path[path.length - 1] as string;
        if (Array.isArray(current)) {
          current[parseInt(lastKey, 10)] = newValue;
        } else {
          (current as Record<string, JsonValue>)[lastKey] = newValue;
        }
        return updated;
      });
    },
    []
  );

  const handleSave = async () => {
    try {
      const docToSave = viewMode === "json" ? JSON.parse(json) : currentDocument;
      setIsSaving(true);
      await onSave(docToSave);
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

  const hasChanges = useMemo(() => {
    return JSON.stringify(currentDocument) !== JSON.stringify(document);
  }, [currentDocument, document]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>
              {isNew ? "New Document" : "Edit Document"}
            </SheetTitle>
            
            <div className="flex items-center gap-2">
              <ViewModeToggle
                modes={[
                  { id: "tree", label: "Tree", icon: <IconBinaryTree2 className="h-4 w-4" /> },
                  { id: "json", label: "JSON", icon: <IconCode className="h-4 w-4" /> },
                ]}
                activeMode={viewMode}
                onChange={(mode) => setViewMode(mode as "tree" | "json")}
              />
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-hidden py-4 flex flex-col gap-2">
          {viewMode === "tree" ? (
            <>
              <div className="px-2 border-b pb-2">
                <BreadcrumbNav
                    path={currentPath.map((id, index) => ({
                      id,
                      type: index === currentPath.length - 1 ? "object" : "object", // Simple mapping for now
                    }))}
                    onNavigate={(newPath) => handleNavigate(newPath.map(p => p.id))}
                />
              </div>

              <div className="flex-1 overflow-auto border rounded-md bg-muted/20">
                <TreeView
                  data={currentDocument}
                  currentPath={currentPath}
                  onNavigate={handleNavigate}
                  onValueChange={handleValueChange}
                  isEditable
                />
              </div>
            </>
          ) : (
            <>
              <Textarea
                value={json}
                onChange={(e) => { handleJsonChange(e.target.value); }}
                className={cn(
                  "flex-1 font-mono text-sm resize-none",
                  parseError && "border-destructive"
                )}
                placeholder='{"field": "value"}'
              />
              {parseError && (
                <p className="text-xs text-destructive">{parseError}</p>
              )}
            </>
          )}
        </div>

        <SheetFooter className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {hasChanges && "Unsaved changes"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              <IconX className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || (viewMode === "json" && !!parseError)}
            >
              <IconCheck className="h-4 w-4 mr-1" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export { TreeView } from "./TreeView";
