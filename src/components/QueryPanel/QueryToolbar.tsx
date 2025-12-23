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
  IconChartTreemap,
  IconFileText,
  IconChartBar,
  IconListTree,
  IconClock,
} from "@tabler/icons-react";
import { QueryLimitControl } from "./QueryLimitControl";
import { BackgroundQueryIndicator } from "./BackgroundQueryIndicator";
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
  showOutline: boolean;
  showResults: boolean;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  appliedLimit?: number;
  executeHint?: string;
  beautifyHint?: string;
  focused?: boolean;
  dialect?: SqlDialect | "auto";
  detectedDialect?: SqlDialect;
  isExplainResult?: boolean;
  hasValidResult?: boolean;
  onExecute: () => void;
  onExecuteInBackground?: () => void;
  onCancel: () => void;
  onBeautify: () => void;
  onToggleHistory: () => void;
  onToggleOutline: () => void;
  onToggleResults: () => void;
  onViewModeChange: (
    mode: "table" | "json" | "explain" | "raw" | "stats",
  ) => void;
  onDialectChange?: (dialect: SqlDialect | "auto") => void;
  onFocusEditor?: () => void;
  onViewBackgroundQuery?: (queryId: string) => void;
}

export const QueryToolbar = memo(function QueryToolbar({
  isExecuting,
  query,
  showHistory,
  showOutline,
  showResults,
  viewMode,
  appliedLimit,
  executeHint,
  beautifyHint: _beautifyHint,
  focused = false,
  dialect = "auto",
  detectedDialect: _detectedDialect,
  isExplainResult = false,
  hasValidResult = true,
  onExecute,
  onExecuteInBackground,
  onCancel,
  onBeautify,
  onToggleHistory,
  onToggleOutline,
  onToggleResults,
  onViewModeChange,
  onDialectChange,
  onFocusEditor,
  onViewBackgroundQuery,
}: QueryToolbarProps) {
  return (
    <div className="@container/toolbar flex-shrink-0">
      <div className="flex items-center justify-between gap-1.5 px-1.5 py-1 bg-muted/20">
        {/* Left side */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Results Panel */}
          <Button
            size="icon-sm"
            variant={showResults ? "secondary" : "ghost"}
            onClick={onToggleResults}
            title={showResults ? "Hide results (⌥R)" : "Show results (⌥R)"}
          >
            <IconLayoutRows />
          </Button>

          {/* View Mode Tabs - only visible when results showing and result is valid */}
          {showResults && hasValidResult && (
            <Tabs
              value={viewMode}
              onValueChange={(value) => {
                onViewModeChange(
                  value as "table" | "json" | "explain" | "raw" | "stats",
                );
              }}
              enableShortcuts={true}
              tabGroupId="query-view-mode"
              focused={focused}
              enableGlobalShortcuts={false}
            >
              <TabsList>
                {!isExplainResult && (
                  <>
                    <TabsTrigger
                      value="table"
                      tabIndex={0}
                    >
                      Table
                    </TabsTrigger>
                    <TabsTrigger
                      value="json"
                      tabIndex={1}
                    >
                      JSON
                    </TabsTrigger>
                  </>
                )}
                {isExplainResult && (
                  <>
                    <TabsTrigger
                      value="explain"
                      tabIndex={0}
                    >
                      <IconChartTreemap />
                      Tree
                    </TabsTrigger>
                    <TabsTrigger
                      value="stats"
                      tabIndex={1}
                    >
                      <IconChartBar />
                      Stats
                    </TabsTrigger>
                    <TabsTrigger
                      value="raw"
                      tabIndex={2}
                    >
                      <IconFileText />
                      Raw
                    </TabsTrigger>
                  </>
                )}
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
            <SelectTrigger>
              <IconCode className="h-3 w-3 text-muted-foreground" />
              <SelectValue>Dialect</SelectValue>
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
          {/* Limit Control - always visible */}
          <div className="text-xs">
            <QueryLimitControl
              appliedLimit={appliedLimit}
              onFocusEditor={onFocusEditor}
            />
          </div>

          {/* Outline button - hidden on narrow containers */}
          <Button
            size="sm"
            variant={showOutline ? "secondary" : "ghost"}
            onClick={onToggleOutline}
            className="hidden @[600px]/toolbar:flex"
            title="Toggle outline panel"
          >
            <IconListTree />
            <span>Outline</span>
          </Button>

          {/* History button - hidden on narrow containers */}
          <Button
            size="sm"
            variant={showHistory ? "secondary" : "ghost"}
            onClick={onToggleHistory}
            className="hidden @[500px]/toolbar:flex"
            title="Toggle history panel (⌥H)"
          >
            <IconHistory />
            <span>History</span>
          </Button>

          {/* Format button - hidden on narrow containers */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onBeautify}
            disabled={isExecuting || !query.trim()}
            className="hidden @[500px]/toolbar:flex"
            title="Format SQL (⌥F)"
          >
            <IconWand />
            <span>Format</span>
          </Button>

          {/* Overflow Menu - visible on narrow containers */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="@[500px]/toolbar:hidden"
                  title="More options"
                >
                  <IconDotsVertical />
                </Button>
              }
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

              {/* Outline */}
              <DropdownMenuItem onClick={onToggleOutline} className="text-xs">
                <IconListTree className="h-3 w-3 mr-2" />
                {showOutline ? "Hide Outline" : "Show Outline"}
              </DropdownMenuItem>

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

          {/* Background Query Indicator - shows running background queries */}
          <BackgroundQueryIndicator
            className="hidden @[600px]/toolbar:flex"
            onViewResult={onViewBackgroundQuery}
          />

          {/* Run in Background button - visible on wider screens */}
          {onExecuteInBackground && (
            <Button
              size="sm"
              variant="outline"
              onClick={onExecuteInBackground}
              disabled={isExecuting || !query.trim()}
              className="hidden @[600px]/toolbar:flex"
              title="Run query in background (⇧⌘↵)"
            >
              <IconClock />
              <span>Background</span>
            </Button>
          )}

          {/* Run/Cancel button - always visible */}
          <Button
            size="sm"
            variant={isExecuting ? "destructive" : "default"}
            onClick={isExecuting ? onCancel : onExecute}
            disabled={!query.trim() && !isExecuting}
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
                <IconPlayerStop />
                <span>Stop</span>
              </>
            ) : (
              <>
                <IconPlayerPlay />
                <span>Run</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
