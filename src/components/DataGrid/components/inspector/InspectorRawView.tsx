import { memo, useMemo } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import type { InspectorDocument } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorRawViewProps {
  documents: InspectorDocument[];
  className?: string;
}

// ---------------------------------------------------------------------------
// InspectorRawView — read-only JSON view using CodeEditor
// ---------------------------------------------------------------------------

export const InspectorRawView = memo(function InspectorRawView({
  documents,
  className,
}: InspectorRawViewProps) {
  const jsonValue = useMemo(() => {
    if (documents.length === 0) {
      return "";
    }
    if (documents.length === 1) {
      return JSON.stringify(documents[0], null, 2);
    }
    return JSON.stringify(documents, null, 2);
  }, [documents]);

  if (documents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a row to view raw JSON.
      </div>
    );
  }

  return (
    <CodeEditor
      value={jsonValue}
      language="json"
      readOnly
      lineNumbers={false}
      height="100%"
      className={className}
    />
  );
});
