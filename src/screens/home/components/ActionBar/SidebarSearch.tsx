import { useRef, useEffect, useState, useMemo } from "react";
import { IconSearch, IconX, IconFilter } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Parse filter syntax from search query
// Supports: type:postgres, tag:prod, etc.
export function parseSearchFilters(query: string): {
  text: string;
  filters: { key: string; value: string }[];
} {
  const filters: { key: string; value: string }[] = [];
  let text = query;

  // Match patterns like type:value or tag:value
  // Only match when followed by whitespace — prevents matching while the user is still typing the value
  const filterPattern = /\b(type|tag|db|env):(\S+)(?=\s)/gi;
  let match;

  while ((match = filterPattern.exec(query)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = match[2]?.toLowerCase();
    if (key && value) {
      filters.push({ key, value });
      text = text.replace(match[0], "").trim();
    }
  }

  return { text: text.trim(), filters };
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

export function SidebarSearch() {
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Parse current filters
  const { text, filters } = useMemo(
    () => parseSearchFilters(searchQuery),
    [searchQuery]
  );

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      setShowSuggestions(false);
      inputRef.current?.blur();
    } else if (e.key === "Tab" && !e.shiftKey) {
      const firstItem = document.querySelector<HTMLElement>(
        "[data-connection-item]"
      );
      if (firstItem) {
        e.preventDefault();
        setShowSuggestions(false);
        firstItem.focus();
      }
    } else if (e.key === "ArrowDown") {
      const firstItem = document.querySelector<HTMLElement>(
        "[data-connection-item]"
      );
      if (firstItem) {
        e.preventDefault();
        setShowSuggestions(false);
        firstItem.focus();
      }
    }
  };

  const addFilter = (keyword: string, value: string) => {
    const newFilter = `${keyword}:${value}`;
    const currentParsed = parseSearchFilters(searchQuery);

    // Check if filter already exists
    const exists = currentParsed.filters.some(
      (f) => f.key === keyword && f.value === value
    );

    if (!exists) {
      // Trailing space ensures the filter is recognized as complete by parseSearchFilters
      setSearchQuery((currentParsed.text + " " + newFilter + " ").trimStart());
    }
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeFilter = (filterKey: string, filterValue: string) => {
    const pattern = new RegExp(`\\b${filterKey}:${filterValue}\\b`, "gi");
    setSearchQuery(searchQuery.replace(pattern, "").trim());
  };

  const clearAllFilters = () => {
    setSearchQuery(text);
  };

  return (
    <div className="px-3 py-2">
      <Popover open={showSuggestions && isFocused} onOpenChange={setShowSuggestions}>
        <PopoverTrigger
          render={
            <div className="relative">
              <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground shrink-0" />
              {!searchQuery && !isFocused && (
                <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-muted rounded"
                >
                  <IconX className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
              <Input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.endsWith(":") || e.target.value === "") {
                    setShowSuggestions(true);
                  }
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  setIsFocused(true);
                  setShowSuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setIsFocused(false);
                    setShowSuggestions(false);
                  }, 150);
                }}
                placeholder="Search... (type: tag:)"
                className={cn(
                  "px-8 h-8 text-xs",
                  "flex-1 bg-transparent text-sm outline-none",
                  "placeholder:text-muted-foreground"
                )}
              />
            </div>
          }
        />
        <PopoverContent
          className="w-[260px] p-0"
          align="start"
          sideOffset={4}
        >
          <div className="p-2 space-y-2">
            <div className="text-xs font-medium text-muted-foreground px-1">
              Filter by type
            </div>
            <div className="flex flex-wrap gap-1">
              {DB_TYPE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.value}
                  type="button"
                  onClick={() => { addFilter(suggestion.keyword, suggestion.value); }}
                  className={cn(
                    "text-xs px-2 py-1 rounded-md border",
                    "hover:bg-accent transition-colors",
                    filters.some(
                      (f) =>
                        f.key === suggestion.keyword &&
                        f.value === suggestion.value
                    )
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/50"
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
                  onClick={() => { addFilter(suggestion.keyword, suggestion.value); }}
                  className={cn(
                    "text-xs px-2 py-1 rounded-md border",
                    "hover:bg-accent transition-colors",
                    filters.some(
                      (f) =>
                        f.key === suggestion.keyword &&
                        f.value === suggestion.value
                    )
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/50"
                  )}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>

            <div className="text-[10px] text-muted-foreground px-1 pt-2 border-t">
              Tip: Type <code className="bg-muted px-1 rounded">type:</code> or{" "}
              <code className="bg-muted px-1 rounded">tag:</code> followed by a value
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Active filters */}
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          <IconFilter className="h-3 w-3 text-muted-foreground" />
          {filters.map((filter, index) => (
            <span
              key={`${filter.key}-${filter.value}-${index}`}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
            >
              {filter.key}:{filter.value}
              <button
                type="button"
                onClick={() => { removeFilter(filter.key, filter.value); }}
                className="hover:bg-primary/20 rounded-sm"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {filters.length > 1 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
