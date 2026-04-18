import { memo } from "react";
import { Button } from "@/components/ui/button";
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
  IconWand,
  IconBraces,
  IconChevronDown,
  IconAlertTriangle,
  IconReportAnalytics,
} from "@tabler/icons-react";
import type { SqlDialect } from "@/components/CodeEditor";
import type { VariableScope } from "@/lib/queryVariables/types";

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
  { value: "oracle", label: "Oracle", description: "Oracle SQL and PL/SQL syntax" },
  { value: "plsql", label: "PL/SQL", description: "Procedural SQL syntax" },
];

interface QueryToolbarProps {
  isExecuting: boolean;
  hasQuery: boolean;
  showResults: boolean;
  showVariables?: boolean;
  hasVariables?: boolean;
  variableScope?: VariableScope;
  variableStatementCount?: number;
  onVariableScopeChange?: (scope: VariableScope) => void;
  runLabel?: string;
  executeHint?: string;
  beautifyHint?: string;
  dialect?: SqlDialect | "auto";
  detectedDialect?: SqlDialect;
  onExecute: () => void;
  onExecuteAll?: () => void;
  onExplain?: () => void;
  onCancel: () => void;
  onBeautify: () => void;
  onToggleResults: () => void;
  onToggleVariables?: () => void;
  onDialectChange?: (dialect: SqlDialect | "auto") => void;
  showplanMode?: string | null;
  inTransaction?: boolean;
  /** Optional schema pill slot rendered in the left section of the toolbar. */
  schemaPillSlot?: React.ReactNode;
}

export const QueryToolbar = memo(function QueryToolbar({
  isExecuting,
  hasQuery,
  showResults,
  showVariables = false,
  hasVariables = false,
  variableScope = "global",
  variableStatementCount = 1,
  onVariableScopeChange,
  runLabel = "Run",
  executeHint,
  beautifyHint: _beautifyHint,
  dialect = "auto",
  detectedDialect,
  onExecute,
  onExecuteAll,
  onExplain,
  onCancel,
  onBeautify,
  onToggleResults,
  onToggleVariables,
  onDialectChange,
  showplanMode,
  inTransaction = false,
  schemaPillSlot,
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
    <div className="@container/toolbar shrink-0">
      <div className="flex items-center justify-between gap-1.5 px-1.5 py-1 bg-muted/20">
        {/* Left side */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Results Panel */}
          <Button
            size="sm"
            variant={showResults ? "secondary" : "ghost"}
            onClick={onToggleResults}
            className="!h-6 !w-6 !p-0"
            title={showResults ? "Hide results (⌘J)" : "Show results (⌘J)"}
          >
            <IconLayoutRows className="h-4! w-4!" />
          </Button>

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

          {/* Schema Pill */}
          {schemaPillSlot && (
            <>
              <div className="w-px h-4 bg-border hidden @[400px]/toolbar:block" />
              {schemaPillSlot}
            </>
          )}

          {/* SHOWPLAN Mode Indicator */}
          {showplanMode && (
            <>
              <div className="w-px h-4 bg-border hidden @[400px]/toolbar:block" />
              <div
                className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hidden @[400px]/toolbar:flex"
                title={`Execution plan mode active: ${showplanMode.toUpperCase()}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                {showplanMode.toUpperCase().replace("_", " ")}
              </div>
            </>
          )}

          {/* In Transaction Indicator */}
          {inTransaction && (
            <>
              <div className="w-px h-4 bg-border hidden @[400px]/toolbar:block" />
              <div
                className="flex items-center gap-1 rounded-md bg-status-warn/15 px-2 py-0.5 text-[11px] font-medium text-status-warn border border-status-warn/30"
                title="Active transaction — COMMIT or ROLLBACK to end"
              >
                <IconAlertTriangle className="h-3 w-3" />
                IN TRANSACTION
              </div>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5">
          {/* Variables toggle button - hidden on narrow containers */}
          {onToggleVariables && hasVariables && (
            <Button
              size="sm"
              variant={showVariables ? "secondary" : "ghost"}
              onClick={onToggleVariables}
              className="!h-6 text-xs gap-1 hidden @[500px]/toolbar:flex !px-2"
              title="Toggle Variables Panel"
            >
              <IconBraces className="h-3 w-3" />
              <span>Variables</span>
            </Button>
          )}

          {/* Variable scope toggle - shown when multiple statements */}
          {hasVariables && variableStatementCount > 1 && onVariableScopeChange && (
            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[11px] whitespace-nowrap hidden @[500px]/toolbar:flex">
              <button
                type="button"
                className={
                  "rounded px-1.5 py-0.5 transition-colors whitespace-nowrap " +
                  (variableScope === "global"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                onClick={() => { onVariableScopeChange("global"); }}
              >
                Global
              </button>
              <button
                type="button"
                className={
                  "rounded px-1.5 py-0.5 transition-colors whitespace-nowrap " +
                  (variableScope === "per_statement"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                onClick={() => { onVariableScopeChange("per_statement"); }}
              >
                Per-stmt
              </button>
            </div>
          )}

          {/* Format button - hidden on narrow containers */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onBeautify}
            disabled={isExecuting || !hasQuery}
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

              {/* Variables toggle */}
              {onToggleVariables && hasVariables && (
                <DropdownMenuItem onClick={onToggleVariables} className="text-xs">
                  <IconBraces className="h-3 w-3 mr-2" />
                  {showVariables ? "Hide Variables" : "Show Variables"}
                </DropdownMenuItem>
              )}

              {/* Format */}
              <DropdownMenuItem
                onClick={onBeautify}
                disabled={isExecuting || !hasQuery}
                className="text-xs"
              >
                <IconWand className="h-3 w-3 mr-2" />
                Format SQL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Run/Cancel button - always visible */}
          {isExecuting ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={onCancel}
              className="!h-6 text-xs gap-1 !px-2.5"
              title="Cancel execution"
            >
              <IconPlayerStop className="h-3.5 w-3.5" />
              <span>Stop</span>
            </Button>
          ) : (
            <div className="flex items-center overflow-hidden rounded-md">
              <Button
                size="sm"
                variant="default"
                onClick={onExecute}
                disabled={!hasQuery}
                className="!h-6 text-xs gap-1 !px-2.5 rounded-none border-0 bg-clip-border"
                title={
                  executeHint
                    ? `Execute query (${executeHint})`
                    : "Execute query (⌘↵)"
                }
              >
                <IconPlayerPlay className="h-3.5 w-3.5" />
                <span>{runLabel}</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button
                      {...props}
                      size="sm"
                      variant="default"
                      disabled={!hasQuery}
                      className="!h-6 !w-6 !px-0 rounded-none border-0 border-l border-primary-foreground/20 bg-clip-border"
                      title="Run options"
                    >
                      <IconChevronDown className="h-3 w-3" />
                    </Button>
                  )}
                />
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={onExecuteAll}
                    disabled={!onExecuteAll}
                    className="text-xs"
                  >
                    <IconPlayerPlay className="h-3.5 w-3.5 mr-2" />
                    Run All Statements
                  </DropdownMenuItem>
                  {onExplain && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={onExplain}
                        className="text-xs"
                      >
                        <IconReportAnalytics className="h-3.5 w-3.5 mr-2" />
                        Explain Analyze
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
