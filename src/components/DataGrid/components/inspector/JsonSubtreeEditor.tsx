import { memo, useState, useCallback, useMemo } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JsonSubtreeEditorProps {
  /** The value being edited (object or array). */
  initialValue: unknown;
  /** Called with the parsed new value on save. */
  onSave: (value: unknown) => void;
  /** Called when the user cancels editing. */
  onCancel: () => void;
  className?: string;
}

export const JsonSubtreeEditor = memo(function JsonSubtreeEditor({
  initialValue,
  onSave,
  onCancel,
  className,
}: JsonSubtreeEditorProps) {
  const initialJson = useMemo(() => {
    try {
      return JSON.stringify(initialValue, null, 2);
    } catch {
      return "{}";
    }
  }, [initialValue]);

  const [jsonText, setJsonText] = useState(initialJson);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      setParseError(null);
      onSave(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [jsonText, onSave]);

  const handleChange = useCallback((value: string) => {
    setJsonText(value);
    // Clear error as user types
    setParseError(null);
  }, []);

  return (
    <div className={cn("border rounded-md overflow-hidden my-1", className)}>
      <CodeEditor
        value={jsonText}
        onChange={handleChange}
        language="json"
        lineNumbers={false}
        height="auto"
        minHeight="60px"
        maxHeight="300px"
      />
      {parseError && (
        <div className="px-2 py-1 text-[11px] text-destructive bg-destructive/10 border-t">
          {parseError}
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t bg-muted/30">
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] px-2"
          onClick={handleSave}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
});
