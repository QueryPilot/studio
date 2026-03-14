import { useRef, useEffect, useState, useMemo } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { DbType } from "@/types/connection";
import { parseSearchFilters } from "../ActionBar/SidebarSearch";

export function StatsHeader() {
  const connections = useConnectionStore((s) => s.connections);
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { text, filters } = useMemo(
    () => parseSearchFilters(searchQuery),
    [searchQuery],
  );

  // DB type counts for chips
  const dbTypeCounts = useMemo(() => {
    const counts: Partial<Record<DbType, number>> = {};
    for (const conn of connections) {
      const t = conn.profile.db_type;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a) as [DbType, number][];
  }, [connections]);

  // Global "/" shortcut to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInInput =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA";

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isInInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      setShowSuggestions(false);
      inputRef.current?.blur();
    } else if (e.key === "Backspace" && text === "" && filters.length > 0) {
      // Remove last filter when backspacing on empty text
      const lastFilter = filters[filters.length - 1];
      if (lastFilter) {
        removeFilter(lastFilter.key, lastFilter.value);
      }
    } else if (e.key === "Tab" && !e.shiftKey) {
      const firstItem = document.querySelector<HTMLElement>(
        "[data-connection-item]",
      );
      if (firstItem) {
        e.preventDefault();
        setShowSuggestions(false);
        firstItem.focus();
      }
    } else if (e.key === "ArrowDown") {
      const firstItem = document.querySelector<HTMLElement>(
        "[data-connection-item]",
      );
      if (firstItem) {
        e.preventDefault();
        setShowSuggestions(false);
        firstItem.focus();
      }
    }
  };

  // Build the full query string from filters + text
  // Each filter token is followed by a space so parseSearchFilters recognises it as complete
  const buildQuery = (newText: string, currentFilters: { key: string; value: string }[]) => {
    const filterParts = currentFilters.map((f) => `${f.key}:${f.value}`);
    if (filterParts.length === 0) return newText;
    return filterParts.join(" ") + " " + newText;
  };

  const addFilter = (keyword: string, value: string) => {
    const exists = filters.some(
      (f) => f.key === keyword && f.value === value,
    );
    if (!exists) {
      setSearchQuery(buildQuery(text, [...filters, { key: keyword, value }]));
    }
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeFilter = (filterKey: string, filterValue: string) => {
    const remaining = filters.filter(
      (f) => !(f.key === filterKey && f.value === filterValue),
    );
    setSearchQuery(buildQuery(text, remaining));
    inputRef.current?.focus();
  };

  const handleTextChange = (newText: string) => {
    setSearchQuery(buildQuery(newText, filters));
    if (newText.endsWith(":") || newText === "") {
      setShowSuggestions(true);
    }
  };

  const clearAll = () => {
    setSearchQuery("");
    inputRef.current?.focus();
  };

  const isOpen = showSuggestions && isFocused;
  const hasFiltersOrText = filters.length > 0 || text.length > 0;

  if (connections.length === 0) return null;

  return (
    <div ref={containerRef} className="flex items-center gap-3">
      {/* Search input with inline badges */}
      <div className="relative flex-1 max-w-lg">
        <div
          className={cn(
            "flex items-center gap-1 flex-wrap min-h-[32px] rounded-md border bg-muted/50 px-2 py-1 cursor-text",
            isFocused && "ring-1 ring-ring border-ring",
          )}
          onClick={() => {
            inputRef.current?.focus();
          }}
        >
          <IconSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          {/* Inline filter badges */}
          {filters.map((filter, index) => (
            <span
              key={`${filter.key}-${filter.value}-${index}`}
              className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0"
            >
              {filter.key}:{filter.value}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  removeFilter(filter.key, filter.value);
                }}
                className="hover:bg-primary/20 rounded-sm ml-0.5"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}

          {/* Text input - only shows free text, not filter tokens */}
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => {
              handleTextChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setIsFocused(true);
              setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => {
                setIsFocused(false);
              }, 200);
            }}
            placeholder={filters.length > 0 ? "Search..." : "Search connections..."}
            className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />

          {hasFiltersOrText ? (
            <button
              type="button"
              onClick={clearAll}
              className="p-0.5 hover:bg-muted rounded shrink-0"
            >
              <IconX className="h-3 w-3 text-muted-foreground" />
            </button>
          ) : !isFocused ? (
            <Kbd className="shrink-0">/</Kbd>
          ) : null}
        </div>

        {/* Suggestions dropdown */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-0.5 w-[280px] bg-popover text-popover-foreground rounded-lg shadow-lg ring-1 ring-foreground/10 z-50 p-2 space-y-2 animate-in fade-in-0 zoom-in-95 duration-100">
            <div className="text-xs font-medium text-muted-foreground px-1">
              Filter by type
            </div>
            <div className="flex flex-wrap gap-1">
              {DB_TYPE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addFilter(suggestion.keyword, suggestion.value);
                  }}
                  className={cn(
                    "text-xs px-2 py-1 rounded-md border",
                    "hover:bg-accent transition-colors",
                    filters.some(
                      (f) =>
                        f.key === suggestion.keyword &&
                        f.value === suggestion.value,
                    )
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/50",
                  )}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>

            <div className="text-xs font-medium text-muted-foreground px-1 pt-2">
              Filter by tag
            </div>
            <div className="flex flex-wrap gap-1">
              {ENV_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addFilter(suggestion.keyword, suggestion.value);
                  }}
                  className={cn(
                    "text-xs px-2 py-1 rounded-md border",
                    "hover:bg-accent transition-colors",
                    filters.some(
                      (f) =>
                        f.key === suggestion.keyword &&
                        f.value === suggestion.value,
                    )
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/50",
                  )}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>

            <div className="text-[10px] text-muted-foreground px-1 pt-2 border-t">
              Tip: Type <code className="bg-muted px-1 rounded">type:</code>{" "}
              or <code className="bg-muted px-1 rounded">tag:</code> followed
              by a value
            </div>
          </div>
        )}
      </div>

      {/* DB type chips */}
      <div className="flex items-center gap-1.5">
        {dbTypeCounts.map(([dbType, count]) => (
          <button
            key={dbType}
            type="button"
            onClick={() => {
              addFilter("type", dbType.toLowerCase());
            }}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
              filters.some(
                (f) =>
                  f.key === "type" &&
                  dbType.toLowerCase().includes(f.value),
              )
                ? "bg-primary/10 ring-1 ring-primary/30"
                : "bg-muted/30 hover:bg-muted/50",
            )}
            title={`Filter by ${dbType}`}
          >
            <img
              src={getDatabaseLogo(dbType)}
              alt=""
              className="h-3.5 w-3.5"
            />
            <span className="text-xs font-medium">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Database type suggestions
const DB_TYPE_SUGGESTIONS = [
  { label: "PostgreSQL", value: "postgresql", keyword: "type" },
  { label: "MySQL", value: "mysql", keyword: "type" },
  { label: "SQLite", value: "sqlite", keyword: "type" },
  { label: "SQL Server", value: "sqlserver", keyword: "type" },
  { label: "MongoDB", value: "mongodb", keyword: "type" },
  { label: "Redis", value: "redis", keyword: "type" },
  { label: "MariaDB", value: "mariadb", keyword: "type" },
];

// Environment tag suggestions
const ENV_SUGGESTIONS = [
  { label: "Local", value: "local", keyword: "tag" },
  { label: "Development", value: "dev", keyword: "tag" },
  { label: "Staging", value: "staging", keyword: "tag" },
  { label: "UAT", value: "uat", keyword: "tag" },
  { label: "Production", value: "prod", keyword: "tag" },
  { label: "Test", value: "test", keyword: "tag" },
];
