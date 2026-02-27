import { memo, useMemo, useState } from "react";
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
// DiffFieldRow — renders one field with reference value and differing values
// ---------------------------------------------------------------------------

function DiffFieldRow({
  field,
  referenceValue,
  otherValues,
  isDiff,
}: {
  field: string;
  referenceValue: unknown;
  otherValues: { rowIndex: number; value: unknown }[];
  isDiff: boolean;
}) {
  const refDisplay = formatValueForDisplay(referenceValue);

  return (
    <div className="text-xs leading-6 py-0.5">
      <div className="flex items-start gap-1">
        <span className="text-muted-foreground font-medium shrink-0">
          {field}:
        </span>
        <div className="min-w-0 flex-1">
          {/* Reference value (Row 1) */}
          <div className="flex items-start gap-1">
            <span className="text-muted-foreground shrink-0">Row 1:</span>
            <span className="font-mono break-all whitespace-pre-wrap">
              {refDisplay}
            </span>
          </div>

          {/* Other row values */}
          {otherValues.map(({ rowIndex, value }) => {
            const display = formatValueForDisplay(value);
            const differs = isDiff && refDisplay !== display;

            return (
              <div key={rowIndex} className="flex items-start gap-1">
                <span className="text-muted-foreground shrink-0">
                  Row {rowIndex}:
                </span>
                <span
                  className={cn(
                    "font-mono break-all whitespace-pre-wrap",
                    differs &&
                      "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-0.5",
                  )}
                >
                  {display}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorDiffView — main export
// ---------------------------------------------------------------------------

export const InspectorDiffView = memo(function InspectorDiffView({
  documents,
  className,
}: InspectorDiffViewProps) {
  const [search, setSearch] = useState("");
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

  // Partition keys into diff and identical groups, applying search filter
  const { diffKeys, identicalKeys } = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const matchesSearch = (key: string): boolean => {
      if (!normalizedSearch) return true;

      // Check field name
      if (key.toLowerCase().includes(normalizedSearch)) return true;

      // Check all values across documents
      for (const doc of documents) {
        const text = toSearchableText(doc[key]);
        if (text.toLowerCase().includes(normalizedSearch)) return true;
      }

      return false;
    };

    const filtered = allKeys.filter(matchesSearch);
    const dKeys: string[] = [];
    const iKeys: string[] = [];

    for (const key of filtered) {
      if (diffFields.has(key)) {
        dKeys.push(key);
      } else {
        iKeys.push(key);
      }
    }

    return { diffKeys: dKeys, identicalKeys: iKeys };
  }, [allKeys, diffFields, documents, search]);

  // Empty state
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

  // Safe: we returned early above when documents.length < 2
  const reference = documents[0] as InspectorDocument;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
        placeholder="Search fields or values..."
        className="h-8 text-xs mb-2 shrink-0"
      />
      <ScrollArea className="flex-1 rounded border p-2">
        {/* Diff fields (always shown) */}
        {diffKeys.length === 0 && identicalKeys.length === 0 && (
          <div className="text-xs text-muted-foreground py-2">
            No matching fields found.
          </div>
        )}

        {diffKeys.length === 0 && identicalKeys.length > 0 && !showIdentical && (
          <div className="text-xs text-muted-foreground py-2">
            All fields are identical across selected records.
          </div>
        )}

        {diffKeys.map((key) => (
          <DiffFieldRow
            key={key}
            field={key}
            referenceValue={reference[key]}
            otherValues={documents.slice(1).map((doc, i) => ({
              rowIndex: i + 2,
              value: doc[key],
            }))}
            isDiff
          />
        ))}

        {/* Identical fields — collapsible section */}
        {identicalKeys.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <button
              type="button"
              onClick={() => {
                setShowIdentical((prev) => !prev);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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

            {showIdentical &&
              identicalKeys.map((key) => (
                <DiffFieldRow
                  key={key}
                  field={key}
                  referenceValue={reference[key]}
                  otherValues={documents.slice(1).map((doc, i) => ({
                    rowIndex: i + 2,
                    value: doc[key],
                  }))}
                  isDiff={false}
                />
              ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
