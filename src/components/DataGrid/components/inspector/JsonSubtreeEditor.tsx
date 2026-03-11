import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { selectNextOccurrence } from "@codemirror/search";
import { keymap, EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
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

/** Lightweight CodeMirror extensions for inline JSON editing — no SQL linter, search UI, autocomplete, etc. */
const MINIMAL_JSON_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  history(),
  keymap.of([
    ...historyKeymap,
    ...defaultKeymap,
    { key: "Mod-d", run: selectNextOccurrence },
  ]),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: "12px",
    },
  }),
];

/** Build action keymap extension — extracted so React Compiler doesn't trace ref reads. */
function buildActionKeymap(
  onSave: () => void,
  onCancel: () => void,
) {
  return Prec.highest(
    keymap.of([
      { key: "Escape", run: () => { onCancel(); return true; } },
      { key: "Mod-Enter", run: () => { onSave(); return true; } },
    ]),
  );
}

export const JsonSubtreeEditor = memo(function JsonSubtreeEditor({
  initialValue,
  onSave,
  onCancel,
  className,
}: JsonSubtreeEditorProps) {
  const { resolvedTheme } = useTheme();
  const initialJson = useMemo(() => {
    try {
      return JSON.stringify(initialValue, null, 2);
    } catch {
      return "{}";
    }
  }, [initialValue]);

  // Uncontrolled pattern: freeze the initial value for CodeMirror to avoid
  // the "typing latch" bug where re-renders overwrite user edits.
  // Same approach as CodeEditor/index.tsx line 66.
  const [initialDoc] = useState(initialJson);

  const [jsonText, setJsonText] = useState(initialJson);
  const [parseError, setParseError] = useState<string | null>(null);

  // Use refs for callbacks accessed by CodeMirror keymaps so the extensions
  // array stays stable across keystrokes (same pattern as CodeEditor/index.tsx).
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const jsonTextRef = useRef(jsonText);

  useEffect(() => {
    onSaveRef.current = onSave;
    onCancelRef.current = onCancel;
  }, [onSave, onCancel]);

  useEffect(() => {
    jsonTextRef.current = jsonText;
  }, [jsonText]);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonTextRef.current) as unknown;
      setParseError(null);
      onSaveRef.current(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, []);

  const handleChange = useCallback((value: string) => {
    setJsonText(value);
    setParseError(null);
  }, []);

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  // Stable wrappers that read from refs — avoids accessing refs during render
  // while keeping the keymap identity stable (same pattern as CodeEditor/index.tsx).
  const onCancelWrapper = useCallback(() => {
    onCancelRef.current();
  }, []);

  const actionKeymap = useMemo(
    () =>
      buildActionKeymap(
        // eslint-disable-next-line react-hooks/refs
        handleSave,
        // eslint-disable-next-line react-hooks/refs
        onCancelWrapper,
      ),
    [handleSave, onCancelWrapper],
  );

  const extensions = useMemo(
    () => [...MINIMAL_JSON_EXTENSIONS, ...themeExtensions, actionKeymap],
    [themeExtensions, actionKeymap],
  );

  return (
    <div className={cn("border rounded-md overflow-hidden my-1", className)}>
      <CodeMirror
        value={initialDoc}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        height="auto"
        minHeight="60px"
        maxHeight="300px"
        autoFocus
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          autocompletion: false,
          defaultKeymap: false,
          searchKeymap: false,
          closeBrackets: true,
        }}
      />
      {parseError && (
        <div className="px-2 py-1 text-[11px] text-destructive bg-destructive/10 border-t">
          {parseError}
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 px-2 py-1.5 border-t bg-muted/30">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] px-2"
          onClick={handleSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
});
