import React, { useState, useRef, useEffect, useCallback } from "react";
import type { ReferenceCustomCell } from "./types";
import { Button } from "@/components/ui/button";
import { XIcon, SearchIcon, Loader2Icon, Key } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface ReferenceCellEditorProps {
  value: ReferenceCustomCell;
  onFinishedEditing: (
    newValue?: ReferenceCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

interface SearchResult {
  [key: string]: unknown;
}

export const ReferenceCellEditor: React.FC<ReferenceCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value ? String(value.data.value) : "";
  const [searchText, setSearchText] = useState<string>(initialValue);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  // Debounced search
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || !value.data.fkReference) {
        setResults([]);
        return;
      }

      setIsSearching(true);

      // TODO: Replace with actual backend call
      // For now, simulate search delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Mock results - in real implementation, call backend API:
      // const response = await fetch('/api/table/search', {
      //   method: 'POST',
      //   body: JSON.stringify({
      //     connectionId,
      //     database,
      //     schema: value.data.fkReference.schema,
      //     table: value.data.fkReference.table,
      //     query,
      //     limit: 10
      //   })
      // });

      setResults([]);
      setIsSearching(false);
    },
    [value.data.fkReference],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setSearchText(newText);
    setSelectedIndex(-1);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      void performSearch(newText);
    }, 300);
  };

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
        },
        copyData: nextValue ? String(nextValue) : "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      const pkColumn = value.data.fkReference?.column || "id";
      const pkValue = result[pkColumn];

      // Try to find a display value (first string column that's not the PK)
      const displayCol = Object.keys(result).find(
        (key) => key !== pkColumn && typeof result[key] === "string",
      );
      const displayValue = displayCol
        ? String(result[displayCol])
        : String(pkValue);

      if (pkValue !== null && pkValue !== undefined) {
        commit(pkValue as string | number, displayValue);
      }
    },
    [commit, value.data.fkReference],
  );

  const commitCurrentValue = useCallback(() => {
    if (selectedIndex >= 0 && results[selectedIndex]) {
      handleSelectResult(results[selectedIndex]);
      return;
    }

    const trimmed = searchText.trim();
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else if (trimmed) {
      commit(trimmed);
    }
  }, [
    commit,
    handleSelectResult,
    results,
    searchText,
    selectedIndex,
    value.data.nullable,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitCurrentValue();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      onFinishedEditing(value, movement);
    }
  };

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const fkRef = value.data.fkReference;
  const refTableName = fkRef ? `${fkRef.schema}.${fkRef.table}` : "unknown";
  const { columnName, isPrimaryKey, dbType } = value.data;

  return (
    <div className="w-full h-full click-outside-ignore">
      <div className="absolute inset-0 flex flex-col bg-background border border-border rounded-md shadow-lg z-50 min-w-[400px] min-h-[300px]">
        {/* Header with column info */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/50">
          {isPrimaryKey && (
            <Key className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
          )}
          <span className="text-[10px] font-medium text-foreground/80">
            {columnName}
          </span>
          {dbType && (
            <span className="text-[9px] text-muted-foreground ml-auto">
              {dbType}
            </span>
          )}
        </div>

        {/* Editor content */}
        <div className="flex flex-col p-2 gap-2 flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Search in {refTableName}</span>
            {value.data.nullable && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-xs"
                onClick={handleClear}
                title="Clear (NULL)"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            )}
          </div>

        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={searchText}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            className="w-full h-8 pl-7 pr-2 text-xs bg-background border border-border rounded outline-none"
            placeholder="Search any column..."
          />
          {isSearching && (
            <Loader2Icon className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
            {results.map((result, index) => {
              const pkColumn = value.data.fkReference?.column || "id";
              const pkValue = result[pkColumn];
              const displayColumns = Object.keys(result).slice(0, 3);

              return (
                <button
                  key={index}
                  onClick={() => {
                    handleSelectResult(result);
                  }}
                  className={cn(
                    "flex flex-col gap-0.5 p-2 text-left text-xs rounded hover:bg-accent",
                    selectedIndex === index && "bg-accent",
                  )}
                >
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {pkColumn}: {String(pkValue)}
                  </div>
                  <div className="flex gap-2">
                    {displayColumns.map((col) => (
                      <span key={col} className="truncate">
                        <span className="text-muted-foreground">{col}:</span>{" "}
                        {String(result[col])}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!isSearching && searchText && results.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No results found
          </div>
        )}

        <div className="text-[10px] text-muted-foreground">
          Type to search • Enter to select • Esc to cancel
        </div>
        </div>
      </div>
    </div>
  );
};

export const ReferenceCellEditorWithProps = Object.assign(ReferenceCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
