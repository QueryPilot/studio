import { memo, useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap, EditorView } from "@codemirror/view";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";

// ---------------------------------------------------------------------------
// CodeMirror extensions
// ---------------------------------------------------------------------------

const JSON_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  history(),
  keymap.of([...historyKeymap, ...defaultKeymap]),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "12px",
    },
  }),
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineCodeViewProps {
  stages: string[];
  onChange: (stages: string[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Combine individual stage JSON strings into a single pipeline JSON array. */
function combinePipeline(stages: string[]): string {
  try {
    const parsed = stages
      .filter((s) => s.trim().length > 0)
      .map((s) => JSON.parse(s) as unknown);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // If any stage is invalid JSON, show the raw concatenation
    return `[\n${stages.map((s) => `  ${s}`).join(",\n")}\n]`;
  }
}

/** Parse a full pipeline JSON array into individual stage strings. */
function splitPipeline(json: string): string[] | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((stage: unknown) => JSON.stringify(stage, null, 2));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PipelineCodeView = memo(function PipelineCodeView({
  stages,
  onChange,
}: PipelineCodeViewProps) {
  const { resolvedTheme } = useTheme();

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...themeExtensions],
    [themeExtensions],
  );

  const combinedValue = useMemo(() => combinePipeline(stages), [stages]);

  const handleChange = useCallback(
    (value: string) => {
      const nextStages = splitPipeline(value);
      if (nextStages) {
        onChange(nextStages);
      }
    },
    [onChange],
  );

  return (
    <div className="flex h-full flex-col">
      <CodeMirror
        value={combinedValue}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        height="100%"
        className="h-full"
        placeholder="[]"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          autocompletion: false,
          defaultKeymap: false,
          searchKeymap: false,
          closeBrackets: true,
        }}
      />
    </div>
  );
});
