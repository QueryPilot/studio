/**
 * MongoDB Document Editor Component
 *
 * A JSON editor for creating and editing MongoDB documents.
 */

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IconCheck, IconX } from "@tabler/icons-react";
import { toast } from "sonner";

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
  const [isSaving, setIsSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const isNew = !document._id;

  useEffect(() => {
    // Format the document as pretty JSON
    setJson(JSON.stringify(document, null, 2));
    setParseError(null);
  }, [document]);

  const handleJsonChange = (value: string) => {
    setJson(value);
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(json);
      setIsSaving(true);
      await onSave(parsed);
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
          <SheetTitle>
            {isNew ? "New Document" : `Edit Document`}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-hidden py-4">
          <Textarea
            value={json}
            onChange={(e) => handleJsonChange(e.target.value)}
            className="h-full font-mono text-sm resize-none"
            placeholder='{"field": "value"}'
          />
          {parseError && (
            <p className="text-xs text-destructive mt-2">{parseError}</p>
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
