/**
 * DiffView Component
 *
 * Displays inline character-level diffs for cell value changes.
 * Uses the `diff` library for accurate diffing.
 */

import { useMemo } from "react";
import { diffChars, diffWords, type Change } from "diff";
import ReactDiffViewer from "react-diff-viewer-continued";
import { cn } from "@/lib/utils";

type Granularity = "char" | "word";

interface DiffInlineProps {
  oldText: string;
  newText: string;
  granularity?: Granularity;
  className?: string;
}

/**
 * Inline diff view showing additions (green) and removals (red) with strikethrough
 */
export function DiffInline({
  oldText,
  newText,
  granularity = "char",
  className,
}: DiffInlineProps) {
  const parts = useMemo<Change[]>(() => {
    switch (granularity) {
      case "word":
        return diffWords(oldText, newText);
      default:
        return diffChars(oldText, newText);
    }
  }, [oldText, newText, granularity]);

  return (
    <div
      className={cn(
        "font-mono text-xs whitespace-pre-wrap break-words p-2 rounded border bg-muted/30",
        className,
      )}
    >
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              className="bg-green-500/20 text-green-700 dark:text-green-300"
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              className="bg-destructive/20 text-destructive line-through"
            >
              {part.value}
            </span>
          );
        }
        return (
          <span key={i} className="text-foreground">
            {part.value}
          </span>
        );
      })}
    </div>
  );
}

interface DiffSideBySideProps {
  oldText: string;
  newText: string;
  className?: string;
}

/**
 * Side-by-side diff view (GitHub-style) for JSON or large text
 * Uses react-diff-viewer for line-by-line highlighting
 */
export function DiffSideBySide({
  oldText,
  newText,
  className,
}: DiffSideBySideProps) {
  // Detect dark mode from the document
  const isDarkMode = useMemo(() => {
    return document.documentElement.classList.contains("dark");
  }, []);

  return (
    <div
      className={cn(
        "text-[9px] rounded overflow-hidden border max-h-32",
        className,
      )}
    >
      <ReactDiffViewer
        oldValue={oldText}
        newValue={newText}
        splitView={true}
        leftTitle="" // Hide title
        rightTitle="" // Hide title
        useDarkTheme={isDarkMode}
        hideLineNumbers={true} // Hide line numbers for compact view
        showDiffOnly={false}
        styles={{
          variables: {
            light: {
              diffViewerBackground: "#fafafa",
              addedBackground: "#e6ffec",
              addedColor: "#24292e",
              removedBackground: "#ffeef0",
              removedColor: "#24292e",
              wordAddedBackground: "#acf2bd",
              wordRemovedBackground: "#fdb8c0",
              addedGutterBackground: "#cdffd8",
              removedGutterBackground: "#ffdce0",
              gutterBackground: "#f6f8fa",
              gutterBackgroundDark: "#f3f4f6",
              highlightBackground: "#fffbdd",
              highlightGutterBackground: "#fff5b1",
            },
            dark: {
              diffViewerBackground: "#1e1e1e",
              addedBackground: "#044B53",
              addedColor: "#e6ffec",
              removedBackground: "#632F34",
              removedColor: "#ffdce0",
              wordAddedBackground: "#055d67",
              wordRemovedBackground: "#7d383f",
              addedGutterBackground: "#034148",
              removedGutterBackground: "#5a2828",
              gutterBackground: "#2e2e2e",
              gutterBackgroundDark: "#262626",
              highlightBackground: "#3d3d00",
              highlightGutterBackground: "#4d4d00",
            },
          },
          line: {
            fontSize: "11px",
            fontFamily: "ui-monospace, monospace",
            padding: "0px 4px",
            lineHeight: "1",
          },
          contentText: {
            fontSize: "11px",
            fontFamily: "ui-monospace, monospace",
          },
          gutter: {
            minWidth: "0px",
            padding: "0",
          },
          titleBlock: {
            display: "none",
          },
          diffContainer: {
            minWidth: "auto",
          },
          splitView: {
            minWidth: "auto",
          },
        }}
      />
    </div>
  );
}

/**
 * Helper to format a cell value (handles JSON, objects, null, etc.)
 */
export function formatCellValue(value: unknown): {
  formatted: string;
  isJson: boolean;
} {
  if (value === null || value === undefined) {
    return { formatted: "NULL", isJson: false };
  }

  // Check if it's a JSON object
  if (typeof value === "object") {
    return { formatted: JSON.stringify(value, null, 2), isJson: true };
  }

  // Check if it's a JSON string
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
      }
    } catch {
      // Not JSON, treat as regular string
    }
    return { formatted: value, isJson: false };
  }

  // For primitives (number, boolean, bigint, symbol)
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return { formatted: String(value), isJson: false };
  }

  // Fallback for other objects (shouldn't reach here due to earlier check)
  return { formatted: JSON.stringify(value, null, 2), isJson: true };
}

interface DiffViewProps {
  before: unknown;
  after: unknown;
  className?: string;
}

/**
 * Smart diff view that always uses side-by-side split view
 * Automatically detects JSON and formats it properly
 */
export function DiffView({ before, after, className }: DiffViewProps) {
  const beforeFormatted = formatCellValue(before);
  const afterFormatted = formatCellValue(after);

  // Always use side-by-side split view for consistency
  return (
    <DiffSideBySide
      oldText={beforeFormatted.formatted}
      newText={afterFormatted.formatted}
      className={className}
    />
  );
}
