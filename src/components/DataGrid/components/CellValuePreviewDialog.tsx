import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCopy, IconX, IconCheck } from "@tabler/icons-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { bracketMatching } from "@codemirror/language";
import { json as jsonLang } from "@codemirror/lang-json";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

interface CellValuePreviewPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: unknown;
  columnName?: string;
  dbType?: string;
  /** Viewport-relative bounds of the originating cell. */
  cellBounds?: { x: number; y: number; width: number; height: number };
}

const POPOVER_WIDTH = 520;
const POPOVER_MAX_HEIGHT = 360;
const POPOVER_PADDING = 8;

function formatForDisplay(value: unknown): { text: string; language: "text" | "json" } {
  if (value === null || value === undefined) {
    return { text: "NULL", language: "text" };
  }
  if (typeof value === "string") {
    return { text: value, language: "text" };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), language: "text" };
  }
  if (typeof value === "bigint") {
    return { text: String(value), language: "text" };
  }
  if (value instanceof Date) {
    return { text: value.toISOString(), language: "text" };
  }
  try {
    return { text: JSON.stringify(value, null, 2), language: "json" };
  } catch {
    return { text: Object.prototype.toString.call(value), language: "text" };
  }
}

export const CellValuePreviewDialog = memo(function CellValuePreviewPopover({
  open,
  onOpenChange,
  value,
  columnName,
  dbType,
  cellBounds,
}: CellValuePreviewPopoverProps) {
  const { resolvedTheme } = useTheme();
  const themeMode = resolvedTheme === "dark" ? "dark" : "light";
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  const { text, language } = useMemo(() => formatForDisplay(value), [value]);

  const extensions = useMemo(() => {
    const base = [
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorView.theme({
        "&": { backgroundColor: "transparent" },
        ".cm-scroller": {
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12px",
          lineHeight: "1.55",
        },
        ".cm-content": { padding: "8px 4px" },
        ".cm-gutters": { display: "none" },
      }),
      ...getThemeExtensions(themeMode),
    ];
    if (language === "json") {
      base.push(jsonLang(), bracketMatching());
    }
    return base;
  }, [language, themeMode]);

  useEffect(() => {
    if (!open) return;

    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(POPOVER_WIDTH, vw - POPOVER_PADDING * 2);
      const height = popoverRef.current?.offsetHeight ?? POPOVER_MAX_HEIGHT;

      if (!cellBounds) {
        return {
          top: Math.max(POPOVER_PADDING, (vh - height) / 2),
          left: Math.max(POPOVER_PADDING, (vw - width) / 2),
        };
      }

      const gap = 4;
      const cellLeft = cellBounds.x;
      const cellBottom = cellBounds.y + cellBounds.height;
      const cellTop = cellBounds.y;

      let left = cellLeft;
      left = Math.max(
        POPOVER_PADDING,
        Math.min(left, vw - width - POPOVER_PADDING),
      );

      const bottomSpace = vh - cellBottom - POPOVER_PADDING;
      if (bottomSpace >= Math.min(height, 140)) {
        return { top: cellBottom + gap, left };
      }
      const topSpace = cellTop - POPOVER_PADDING;
      if (topSpace >= Math.min(height, 140)) {
        return { top: Math.max(POPOVER_PADDING, cellTop - height - gap), left };
      }
      return {
        top: Math.max(POPOVER_PADDING, vh - height - POPOVER_PADDING),
        left,
      };
    };

    setPosition(compute());
    const onResize = () => {
      setPosition(compute());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, cellBounds]);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      const node = popoverRef.current;
      if (node && !node.contains(e.target as Node)) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, handleClickOutside, handleKeyDown]);

  const handleCopy = () => {
    writeClipboardText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => { setCopied(false); }, 1200);
      })
      .catch(() => {});
  };

  if (!open || !position) return null;

  const width = Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_PADDING * 2);
  const lineCount = text ? text.split("\n").length : 0;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg bg-popover text-popover-foreground shadow-lg border border-border animate-in fade-in-0 zoom-in-95 duration-100 flex flex-col"
      style={{
        top: position.top,
        left: position.left,
        width,
        maxHeight: POPOVER_MAX_HEIGHT,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40 rounded-t-lg">
        <span className="font-mono text-xs font-medium truncate">
          {columnName ?? "value"}
        </span>
        {dbType && (
          <span className="text-[11px] text-muted-foreground font-normal shrink-0">
            {dbType}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {copied ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconCopy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => { onOpenChange(false); }}
            className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close preview"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      </div>
      <div className={cn("flex-1 min-h-0 overflow-hidden rounded-b-lg")}>
        {text === "NULL" && value == null ? (
          <div className="px-3 py-2 font-mono text-xs italic text-muted-foreground">
            NULL
          </div>
        ) : (
          <CodeMirror
            key={themeMode}
            value={text}
            extensions={extensions}
            theme="none"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              dropCursor: false,
              allowMultipleSelections: true,
              indentOnInput: false,
              autocompletion: false,
              searchKeymap: false,
            }}
            readOnly
            editable={false}
            height="100%"
            maxHeight={`${POPOVER_MAX_HEIGHT - 60}px`}
          />
        )}
      </div>
      <div className="px-3 py-1 text-[10px] text-muted-foreground border-t bg-muted/30 rounded-b-lg shrink-0">
        {text.length.toLocaleString()} chars · {lineCount.toLocaleString()} lines
      </div>
    </div>,
    document.body,
  );
});
