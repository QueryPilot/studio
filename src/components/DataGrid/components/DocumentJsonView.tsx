/**
 * DocumentJsonView - Read-only JSON viewer for MongoDB documents
 *
 * Uses CodeMirror with JSON language mode to render documents
 * as formatted JSON text.
 */

import { memo, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface DocumentJsonViewProps {
  documents: Record<string, unknown>[];
  className?: string;
}

// ============================================================================
// Extensions
// ============================================================================

const JSON_BASE_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "12px",
    },
  }),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

// ============================================================================
// Component
// ============================================================================

export const DocumentJsonView = memo(function DocumentJsonView({
  documents,
  className,
}: DocumentJsonViewProps) {
  const { resolvedTheme } = useTheme();

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  const extensions = useMemo(
    () => [...JSON_BASE_EXTENSIONS, ...themeExtensions],
    [themeExtensions],
  );

  const jsonText = useMemo(
    () => JSON.stringify(documents, null, 2),
    [documents],
  );

  if (documents.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        No documents to display
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <CodeMirror
        value={jsonText}
        extensions={extensions}
        theme="none"
        height="100%"
        className="h-full"
        editable={false}
        readOnly={true}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          autocompletion: false,
          defaultKeymap: false,
          searchKeymap: false,
          closeBrackets: false,
        }}
      />
    </div>
  );
});
