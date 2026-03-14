import { memo, useCallback, useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap, EditorView } from "@codemirror/view";
import { IconGripVertical, IconX } from "@tabler/icons-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { cn } from "@/lib/utils";
import { detectStageType, getStageColorClasses } from "./utils";

// ---------------------------------------------------------------------------
// CodeMirror extensions (same set used in MongoValidation)
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

interface StageCardProps {
  id: string;
  index: number;
  stageJson: string;
  enabled: boolean;
  selected: boolean;
  outputSummary?: { docCount: number; timeMs: number } | null;
  onJsonChange: (json: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onDelete: () => void;
  onSelect: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StageCard = memo(function StageCard({
  id,
  index,
  stageJson,
  enabled,
  selected,
  outputSummary,
  onJsonChange,
  onEnabledChange,
  onDelete,
  onSelect,
}: StageCardProps) {
  const { resolvedTheme } = useTheme();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const stageType = useMemo(() => detectStageType(stageJson), [stageJson]);
  const colorClasses = useMemo(
    () => getStageColorClasses(stageType),
    [stageType],
  );

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...themeExtensions],
    [themeExtensions],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      onJsonChange(value);
    },
    [onJsonChange],
  );

  const handleToggle = useCallback(
    (checked: boolean) => {
      onEnabledChange(checked);
    },
    [onEnabledChange],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={cn(
        "rounded-lg border transition-colors",
        colorClasses,
        selected && "border-primary ring-1 ring-primary/30",
        !enabled && "opacity-50",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...listeners}
          {...attributes}
        >
          <IconGripVertical className="h-4 w-4" />
        </button>

        <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {index + 1}
        </span>

        <span className="text-xs font-semibold">{stageType}</span>

        <div className="ml-auto flex items-center gap-2">
          <Switch
            size="sm"
            checked={enabled}
            onCheckedChange={handleToggle}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body — CodeMirror editor */}
      <div className="border-t px-1">
        <CodeMirror
          value={stageJson}
          onChange={handleEditorChange}
          extensions={extensions}
          theme="none"
          readOnly={!enabled}
          height="auto"
          minHeight="60px"
          maxHeight="200px"
          className="text-xs"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            autocompletion: false,
            defaultKeymap: false,
            searchKeymap: false,
            closeBrackets: true,
          }}
        />
      </div>

      {/* Footer — per-stage output summary */}
      {outputSummary ? (
        <div className="flex items-center gap-3 border-t px-3 py-1 text-[11px] text-muted-foreground">
          <span>{outputSummary.docCount} docs</span>
          <span>{outputSummary.timeMs}ms</span>
        </div>
      ) : null}
    </div>
  );
});
