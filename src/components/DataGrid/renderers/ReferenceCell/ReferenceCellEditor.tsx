import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { ReferenceCustomCell } from "./types";
import { Command as CommandPrimitive } from "cmdk";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { IconLoader2, IconKey, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import { useFKAutocomplete } from "../../hooks/useFKAutocomplete";
import { useEmbeddedFKPreferencesStore } from "../../stores";
import { useShallow } from "zustand/shallow";
import { resolveDisplayColumn } from "../../utils/fkDisplayColumn";
import { useReferencedTableColumns } from "@/hooks/useReferencedTableColumns";

interface ReferenceCellEditorProps {
  value: ReferenceCustomCell;
  onFinishedEditing: (
    newValue?: ReferenceCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

const INITIAL_LIMIT = 20;
const DEBOUNCE_MS = 200;

export const ReferenceCellEditor: React.FC<ReferenceCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value;
  const [inputValue, setInputValue] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [activeValue, setActiveValue] = useState<string>("");
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { connectionId, database, sourceSchema, sourceTable, fkReference, columnName, isPrimaryKey, dbType, nullable } = value.data;

  // Get embedded FK preference for display column
  const storageKey = useMemo(
    () => connectionId && sourceSchema && sourceTable
      ? `${connectionId}:${sourceSchema}.${sourceTable}`
      : "",
    [connectionId, sourceSchema, sourceTable]
  );

  const embeddedColumns = useEmbeddedFKPreferencesStore(
    useShallow((state) => {
      if (!storageKey || !columnName) return [];
      return state.preferences[storageKey]?.embeddedColumns[columnName] ?? [];
    })
  );

  // Get referenced table columns for smart display column detection
  const fkReferencesMap = useMemo(() => {
    if (!fkReference || !columnName) return new Map();
    const map = new Map<string, { schema: string; table: string; column: string }>();
    map.set(columnName, {
      schema: fkReference.schema,
      table: fkReference.table,
      column: fkReference.column,
    });
    return map;
  }, [fkReference, columnName]);

  const referencedTableColumnsMap = useReferencedTableColumns({
    connectionId: connectionId ?? "",
    database: database ?? "",
    fkReferences: fkReferencesMap,
    enabled: !!connectionId && !!database && fkReferencesMap.size > 0,
  });

  const refTableColumns = columnName ? referencedTableColumnsMap[columnName] : undefined;

  // Resolve display column using priority: embedded pref > smart detection > PK
  const displayColumn = useMemo(() => {
    if (!fkReference) return undefined;
    return resolveDisplayColumn(fkReference, embeddedColumns, refTableColumns);
  }, [fkReference, embeddedColumns, refTableColumns]);

  // Fetch FK lookup values
  const { data: lookupData, isLoading } = useFKAutocomplete({
    connectionId: connectionId ?? "",
    database: database ?? "",
    fkReference: fkReference ? {
      schema: fkReference.schema,
      table: fkReference.table,
      column: fkReference.column,
      displayColumn,
    } : null,
    searchTerm: debouncedSearch || undefined,
    limit: INITIAL_LIMIT,
    enabled: !!connectionId && !!database && !!fkReference,
  });

  const results = useMemo(() => lookupData?.values ?? [], [lookupData?.values]);
  const hasMore = lookupData?.hasMore ?? false;

  // Auto-focus input
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => { clearTimeout(timer); };
  }, []);

  // Debounce search input
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(inputValue);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [inputValue]);

  // Keep activeValue in sync with results
  useEffect(() => {
    const firstResult = results[0];
    if (results.length > 0 && !activeValue && firstResult) {
      setActiveValue(String(firstResult.value));
    }
  }, [results, activeValue]);

  const commit = useCallback(
    (nextValue: string | number | null, displayVal?: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: ReferenceCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
          displayValue: displayVal,
          embeddedValue: displayVal ?? null,
        },
        copyData: nextValue != null ? String(nextValue) : "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleSelect = useCallback(
    async (selectedValue: string) => {
      if (finishedRef.current) return;

      // Find the result matching this value
      const result = results.find((r) => String(r.value) === selectedValue);
      if (result) {
        commit(result.value as string | number, result.display);
      } else {
        // User typed a custom value
        const trimmed = selectedValue.trim();
        if (trimmed && !isNaN(Number(trimmed))) {
          commit(Number(trimmed));
        } else if (trimmed) {
          commit(trimmed);
        }
      }
    },
    [commit, results],
  );

  const commitCurrentValue = useCallback(() => {
    // Use activeValue (selected item) if available, otherwise use inputValue
    const valueToCommit = activeValue || inputValue.trim();

    if (!valueToCommit) {
      if (nullable) {
        commit(null);
      } else if (initialValue == null) {
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else {
        finishedRef.current = true;
        onFinishedEditing(undefined);
      }
      return;
    }

    // Find matching result
    const result = results.find((r) => String(r.value) === valueToCommit);
    if (result) {
      commit(result.value as string | number, result.display);
    } else if (!isNaN(Number(valueToCommit))) {
      commit(Number(valueToCommit));
    } else {
      commit(valueToCommit);
    }
  }, [activeValue, inputValue, results, commit, nullable, initialValue, onFinishedEditing]);

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const refTableName = fkReference ? `${fkReference.schema}.${fkReference.table}` : "unknown";

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        <span className="text-[11px] font-medium text-foreground/80">
          {columnName}
        </span>
        <span className="text-[10px] text-muted-foreground">→</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {refTableName}
        </span>
        {dbType && (
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">
            {dbType}
          </span>
        )}
      </div>

      {/* Command combobox */}
      <div className="flex items-center flex-1">
        <Command
          className="w-full border-0 rounded-none shadow-none"
          shouldFilter={false}
          value={activeValue}
          onValueChange={setActiveValue}
        >
          <div className="flex items-center border-b relative">
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder="Search by ID or value..."
              value={inputValue}
              onValueChange={setInputValue}
              className={cn(
                "h-full w-full bg-transparent py-1.5 px-2 text-xs outline-none",
                "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onKeyDown={(e) => {
                if (finishedRef.current) return;

                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSelect(activeValue || inputValue);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  finishedRef.current = true;
                  onFinishedEditing(undefined);
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  e.stopPropagation();
                  finishedRef.current = true;
                  const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
                    ? [-1, 0]
                    : [1, 0];

                  const valueToCommit = activeValue || inputValue.trim();
                  if (valueToCommit) {
                    const result = results.find((r) => String(r.value) === valueToCommit);
                    const newCell: ReferenceCustomCell = {
                      kind: value.kind,
                      data: {
                        ...value.data,
                        value: result ? (result.value as string | number) : (!isNaN(Number(valueToCommit)) ? Number(valueToCommit) : valueToCommit),
                        displayValue: result?.display,
                        embeddedValue: result?.display ?? null,
                      },
                      copyData: valueToCommit,
                      allowOverlay: value.allowOverlay,
                      readonly: value.readonly,
                    };
                    onFinishedEditing(newCell, movement);
                  } else {
                    onFinishedEditing(value, movement);
                  }
                }
              }}
            />
            {isLoading && (
              <IconLoader2 className="absolute right-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <CommandList className="max-h-[200px]">
            <CommandGroup>
              {results.length === 0 && !isLoading && (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  {inputValue ? "No results found" : "No records available"}
                </div>
              )}
              {results.map((result) => {
                const resultValue = String(result.value);
                const isCurrent = result.value === initialValue;
                return (
                  <CommandItem
                    key={resultValue}
                    value={resultValue}
                    onSelect={() => { void handleSelect(resultValue); }}
                    className="text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-muted-foreground w-12 shrink-0">
                        {resultValue}
                      </span>
                      <span className="truncate">
                        {result.display !== resultValue ? result.display : ""}
                      </span>
                    </div>
                    {isCurrent && (
                      <IconCheck className="h-3 w-3 text-green-600" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {/* Footer */}
          <div className="px-2 py-1 border-t border-border/50 bg-muted/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {hasMore ? `${results.length}+ results · Type to narrow` : `${results.length} results`}
            </span>
            <span className="text-[10px] text-muted-foreground">
              ↑↓ navigate · Enter select · Esc cancel
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
};

export const ReferenceCellEditorWithProps = Object.assign(ReferenceCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
