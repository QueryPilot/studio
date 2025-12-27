import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  IconPlayerStop,
  IconPlayerPlay,
  IconCode,
  IconLayoutRows,
  IconDotsVertical,
  IconHistory,
  IconWand,
  IconReportAnalytics,
} from "@tabler/icons-react";
import type { SqlDialect } from "@/components/CodeEditor";

// Dialect display names and descriptions
const DIALECT_OPTIONS: Array<{
  value: SqlDialect | "auto";
  label: string;
  description: string;
}> = [
  { value: "auto", label: "Auto", description: "Auto-detect dialect" },
  {
    value: "postgresql",
    label: "PostgreSQL",
    description: "PostgreSQL syntax",
  },
  { value: "mysql", label: "MySQL", description: "MySQL syntax" },
  { value: "sqlite", label: "SQLite", description: "SQLite syntax" },
  { value: "mssql", label: "SQL Server", description: "T-SQL syntax" },
  { value: "plsql", label: "PL/SQL", description: "Oracle PL/SQL syntax" },
];

interface QueryToolbarProps {
  isExecuting: boolean;
  query: string;
  showHistory: boolean;
  showResults: boolean;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  executeHint?: string;
  beautifyHint?: string;
  focused?: boolean;
  dialect?: SqlDialect | "auto";
  detectedDialect?: SqlDialect;
  onExecute: () => void;
  onCancel: () => void;
  onExplain?: () => void;
  onBeautify: () => void;
  onToggleHistory: () => void;
  onToggleResults: () => void;
  onViewModeChange: (mode: "table" | "json" | "explain" | "raw" | "stats") => void;
  onDialectChange?: (dialect: SqlDialect | "auto") => void;
}

export const QueryToolbar = memo(function QueryToolbar({
  isExecuting,
  query,
  showHistory,
  showResults,
  viewMode,
  executeHint,
  beautifyHint: _beautifyHint,
  focused = false,
  dialect = "auto",
  detectedDialect,
  onExecute,
  onCancel,
  onExplain,
  onBeautify,
  onToggleHistory,
  onToggleResults,
  onViewModeChange,
  onDialectChange,
}: QueryToolbarProps) {
  // Get the display label for the current dialect
  const currentDialectLabel =
    dialect === "auto"
      ? `Auto${
          detectedDialect
            ? ` (${
                DIALECT_OPTIONS.find((d) => d.value === detectedDialect)
                  ?.label || detectedDialect
              })`
            : ""
        }`
      : DIALECT_OPTIONS.find((d) => d.value === dialect)?.label || dialect;

  return (
    <div className="@container/toolbar flex-shrink-0">
      <div className="flex items-center justify-between gap-1.5 px-1.5 py-1 bg-muted/20">
        {/* Left side */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Results Panel */}
          <Button
            size="sm"
            variant={showResults ? "secondary" : "ghost"}
            onClick={onToggleResults}
            className="!h-6 !w-6 !p-0"
            title={showResults ? "Hide results (⌥R)" : "Show results (⌥R)"}
          >
            <IconLayoutRows className="h-3.5 w-3.5" />
          </Button>

          {/* View Mode Tabs - always visible when results showing */}
          {showResults && (
            <Tabs
              value={viewMode}
              onValueChange={(value) => {
                onViewModeChange(value as "table" | "json" | "explain" | "raw" | "stats");
              }}
              enableShortcuts={true}
              tabGroupId="query-view-mode"
              focused={focused}
              enableGlobalShortcuts={false}
            >
              <TabsList className="!h-6 !p-0.5">
                <TabsTrigger
                  value="table"
                  className="text-xs !h-5 !px-2"
                  tabIndex={0}
                >
                  Table
                </TabsTrigger>
                <TabsTrigger
                  value="json"
                  className="text-xs !h-5 !px-2"
                  tabIndex={1}
                >
                  JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="w-px h-4 bg-border hidden @[400px]/toolbar:block" />

          {/* Dialect Selector - hidden on narrow containers */}
          <Select
            value={dialect}
            onValueChange={(value) =>
              onDialectChange?.(value as SqlDialect | "auto")
            }
          >
            <SelectTrigger
              className="!h-6 w-auto min-w-[80px] text-xs gap-1 border-none bg-transparent hover:bg-accent hidden @[400px]/toolbar:flex !px-2"
              title={`SQL Dialect: ${currentDialectLabel}`}
            >
              <IconCode className="h-3 w-3 text-muted-foreground" />
              <SelectValue className="text-xs" />
            </SelectTrigger>
            <SelectContent>
              {DIALECT_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-xs"
                  title={option.description}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5">
          {/* History button - hidden on narrow containers */}
          <Button
            size="sm"
            variant={showHistory ? "secondary" : "ghost"}
            onClick={onToggleHistory}
            className="!h-6 text-xs gap-1 hidden @[500px]/toolbar:flex !px-2"
            title="Toggle history panel (⌥H)"
          >
            <IconHistory className="h-3 w-3" />
            <span>History</span>
          </Button>

          {/* Format button - hidden on narrow containers */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onBeautify}
            disabled={isExecuting || !query.trim()}
            className="!h-6 text-xs gap-1 hidden @[500px]/toolbar:flex !px-2"
            title="Format SQL (⌥F)"
          >
            <IconWand className="h-3 w-3" />
            <span>Format</span>
          </Button>

          {/* Overflow Menu - visible on narrow containers */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button
                  {...props}
                  size="sm"
                  variant="ghost"
                  className="!h-6 !w-6 !p-0 @[500px]/toolbar:hidden"
                  title="More options"
                >
                  <IconDotsVertical className="h-3.5 w-3.5" />
                </Button>
              )}
            />
            <DropdownMenuContent align="end" className="w-44">
              {/* Dialect Selector */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">
                  <IconCode className="h-3 w-3 mr-2" />
                  {DIALECT_OPTIONS.find((d) => d.value === dialect)?.label ||
                    "Auto"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={dialect}
                    onValueChange={(v) =>
                      onDialectChange?.(v as SqlDialect | "auto")
                    }
                  >
                    {DIALECT_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        className="text-xs"
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              {/* History */}
              <DropdownMenuItem onClick={onToggleHistory} className="text-xs">
                <IconHistory className="h-3 w-3 mr-2" />
                {showHistory ? "Hide History" : "Show History"}
              </DropdownMenuItem>

              {/* Format */}
              <DropdownMenuItem
                onClick={onBeautify}
                disabled={isExecuting || !query.trim()}
                className="text-xs"
              >
                <IconWand className="h-3 w-3 mr-2" />
                Format SQL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Explain button */}
          <Button
            size="sm"
            variant="outline"
            onClick={onExplain}
            disabled={isExecuting || !query.trim()}
            className="!h-6 text-xs gap-1 !px-2 hidden @[500px]/toolbar:flex"
            title="Run EXPLAIN ANALYZE"
          >
            <IconReportAnalytics className="h-3.5 w-3.5" />
            <span>Explain</span>
          </Button>

          {/* Run/Cancel button - always visible */}
          <Button
            size="sm"
            variant={isExecuting ? "destructive" : "default"}
            onClick={isExecuting ? onCancel : onExecute}
            disabled={!query.trim() && !isExecuting}
            className="!h-6 text-xs gap-1 !px-2.5"
            title={
              isExecuting
                ? "Cancel execution"
                : executeHint
                ? `Execute query (${executeHint})`
                : "Execute query (⌘↵)"
            }
          >
            {isExecuting ? (
              <>
                <IconPlayerStop className="h-3.5 w-3.5" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <IconPlayerPlay className="h-3.5 w-3.5" />
                <span>Run</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
