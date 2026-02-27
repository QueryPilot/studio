import { memo, useMemo, useDeferredValue, useState, useCallback } from "react";
import { diffChars } from "diff";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  computeDiffFields,
  toSearchableText,
  formatValueForDisplay,
} from "./utils";
import type { InspectorDocument } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorDiffViewProps {
  documents: InspectorDocument[];
  className?: string;
}

// ---------------------------------------------------------------------------
// CharDiffSpan — character-level diff highlighting
// Shows the target row's text with additions highlighted green.
// Removed chars are hidden so only the current row's content appears.
// ---------------------------------------------------------------------------

const CharDiffSpan = memo(function CharDiffSpan({
  referenceText,
  otherText,
}: {
  referenceText: string;
  otherText: string;
}) {
  const parts = useMemo(
    () => diffChars(referenceText, otherText),
    [referenceText, otherText],
  );

  return (
    <span className="text-xs font-mono break-all">
      {parts.map((part, i) => {
        if (part.removed) return null;
        const key = `${i}-${part.added ? "a" : "u"}`;
        if (part.added) {
          return (
            <span
              key={key}
              className="bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300 rounded-sm px-px"
            >
              {part.value}
            </span>
          );
        }
        return <span key={key}>{part.value}</span>;
      })}
    </span>
  );
});

// ---------------------------------------------------------------------------
// DiffFieldRow — one differing field: label + per-row values with diff
// ---------------------------------------------------------------------------

const DiffFieldRow = memo(function DiffFieldRow({
  field,
  referenceValue,
  otherValues,
}: {
  field: string;
  referenceValue: unknown;
  otherValues: { rowIndex: number; value: unknown }[];
}) {
  const refDisplay = formatValueForDisplay(referenceValue);

  return (
    <div className="py-1.5 border-b border-border/40 last:border-b-0">
      <div className="text-muted-foreground font-medium text-[11px] mb-1 sticky top-0 bg-background z-10 py-0.5">
        {field}
      </div>
      <div className="space-y-0.5 pl-2">
        <div className="flex items-baseline gap-2 min-h-[20px]">
          <span className="text-muted-foreground/70 shrink-0 text-[10px] tabular-nums w-10">
            Row 1
          </span>
          <span className="text-xs font-mono break-all">{refDisplay}</span>
        </div>
        {otherValues.map(({ rowIndex, value }) => {
          const display = formatValueForDisplay(value);
          const differs = refDisplay !== display;
          return (
            <div
              key={rowIndex}
              className="flex items-baseline gap-2 min-h-[20px]"
            >
              <span className="text-muted-foreground/70 shrink-0 text-[10px] tabular-nums w-10">
                Row {rowIndex}
              </span>
              {differs ? (
                <CharDiffSpan referenceText={refDisplay} otherText={display} />
              ) : (
                <span className="text-xs font-mono break-all">{display}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// IdenticalFieldRow — compact single-line: field name + value
// ---------------------------------------------------------------------------

const IdenticalFieldRow = memo(function IdenticalFieldRow({
  field,
  value,
}: {
  field: string;
  value: unknown;
}) {
  return (
    <div className="py-1 border-b border-border/40 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-medium text-[11px] shrink-0">
          {field}
        </span>
        <span className="text-xs font-mono text-muted-foreground/80 truncate">
          {formatValueForDisplay(value)}
        </span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// InspectorDiffView — main export
// ---------------------------------------------------------------------------

export const InspectorDiffView = memo(function InspectorDiffView({
  documents,
  className,
}: InspectorDiffViewProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showIdentical, setShowIdentical] = useState(false);

  // Compute union of all diff fields (each doc compared to reference)
  const diffFields = useMemo(() => {
    if (documents.length < 2) return new Set<string>();
    const reference = documents[0] as InspectorDocument;
    const union = new Set<string>();
    for (let i = 1; i < documents.length; i++) {
      for (const field of computeDiffFields(
        reference,
        documents[i] as InspectorDocument,
      )) {
        union.add(field);
      }
    }
    return union;
  }, [documents]);

  // Collect all keys across all documents, preserving insertion order
  const allKeys = useMemo(() => {
    const keySet = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        keySet.add(key);
      }
    }
    return Array.from(keySet);
  }, [documents]);

  // Partition ALL keys into diff/identical once — independent of search.
  // This keeps otherValuesByKey stable across search changes.
  const { allDiffKeys, allIdenticalKeys } = useMemo(() => {
    const dKeys: string[] = [];
    const iKeys: string[] = [];
    for (const key of allKeys) {
      if (diffFields.has(key)) {
        dKeys.push(key);
      } else {
        iKeys.push(key);
      }
    }
    return { allDiffKeys: dKeys, allIdenticalKeys: iKeys };
  }, [allKeys, diffFields]);

  // Apply search filter to partitioned keys (uses deferred value)
  const { diffKeys, identicalKeys } = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return { diffKeys: allDiffKeys, identicalKeys: allIdenticalKeys };
    }

    const matchesSearch = (key: string): boolean => {
      if (key.toLowerCase().includes(normalizedSearch)) return true;
      for (const doc of documents) {
        const text = toSearchableText(doc[key]);
        if (text.toLowerCase().includes(normalizedSearch)) return true;
      }
      return false;
    };

    return {
      diffKeys: allDiffKeys.filter(matchesSearch),
      identicalKeys: allIdenticalKeys.filter(matchesSearch),
    };
  }, [allDiffKeys, allIdenticalKeys, documents, deferredSearch]);

  const reference: InspectorDocument = documents[0] ?? {};
  const otherDocs = useMemo(() => documents.slice(1), [documents]);

  // Pre-build stable otherValues arrays keyed by field so DiffFieldRow's memo works.
  // Keyed on allDiffKeys (not filtered diffKeys) so entries stay stable across search changes.
  const otherValuesByKey = useMemo(() => {
    const map = new Map<string, { rowIndex: number; value: unknown }[]>();
    for (const key of allKeys) {
      map.set(
        key,
        otherDocs.map((doc, i) => ({ rowIndex: i + 2, value: doc[key] })),
      );
    }
    return map;
  }, [allKeys, otherDocs]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const handleToggleIdentical = useCallback(() => {
    setShowIdentical((prev) => !prev);
  }, []);

  // Empty state — < 2 documents
  if (documents.length < 2) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">
            Select 2+ records to compare differences.
          </span>
        </div>
      </div>
    );
  }

  const noDiffs = diffKeys.length === 0;
  const noResults = noDiffs && identicalKeys.length === 0;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Input
        value={search}
        onChange={handleSearchChange}
        placeholder="Search fields or values..."
        className="h-7 text-xs mb-2 shrink-0"
      />
      <ScrollArea className="flex-1">
        {/* Empty state */}
        {noResults && (
          <div className="text-xs text-muted-foreground py-2">
            No matching fields found.
          </div>
        )}

        {/* All identical message */}
        {noDiffs && !noResults && !showIdentical && (
          <div className="text-xs text-muted-foreground py-2">
            All fields are identical across selected records.
          </div>
        )}

        {/* Diff fields */}
        {diffKeys.map((key) => (
          <DiffFieldRow
            key={key}
            field={key}
            referenceValue={reference[key]}
            otherValues={otherValuesByKey.get(key) ?? []}
          />
        ))}

        {/* Toggle for identical fields */}
        {identicalKeys.length > 0 && (
          <div className={cn(diffKeys.length > 0 && "mt-2 border-t pt-2")}>
            <button
              type="button"
              onClick={handleToggleIdentical}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-1"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  showIdentical && "rotate-90",
                )}
              />
              <span>
                {showIdentical ? "Hide" : "Show"} {identicalKeys.length}{" "}
                identical field{identicalKeys.length !== 1 ? "s" : ""}
              </span>
            </button>

            {/* Identical fields — compact single-line each */}
            {showIdentical &&
              identicalKeys.map((key) => (
                <IdenticalFieldRow
                  key={key}
                  field={key}
                  value={reference[key]}
                />
              ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
