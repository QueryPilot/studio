import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { JSON_EXTENSIONS } from "@/components/shared/codemirrorJsonExtensions";

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

  // Use local state to avoid a controlled feedback loop where
  // value -> onChange -> parse/stringify -> new value resets cursor position.
  const [localValue, setLocalValue] = useState(() => combinePipeline(stages));
  const isLocalEdit = useRef(false);

  // Sync from parent when stages change externally (not from our own edits).
  // setState here is intentional: we need to reset the local editor value when
  // the visual stage list is reordered/modified outside the code view.
  useEffect(() => {
    if (!isLocalEdit.current) {
      setLocalValue(combinePipeline(stages)); // eslint-disable-line react-hooks/set-state-in-effect
    }
    isLocalEdit.current = false;
  }, [stages]);

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      isLocalEdit.current = true;
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
        value={localValue}
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
