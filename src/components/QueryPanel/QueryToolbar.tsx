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
  IconBinaryTree,
  IconChevronDown,
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
  hasQuery: boolean;
  showResults: boolean;
  showOutline?: boolean;
  runLabel?: string;
  executeHint?: string;
  beautifyHint?: string;
  dialect?: SqlDialect | "auto";
  detectedDialect?: SqlDialect;
  onExecute: () => void;
  onExecuteAll?: () => void;
  onCancel: () => void;
  onBeautify: () => void;
  onToggleResults: () => void;
  onToggleOutline?: () => void;
  onDialectChange?: (dialect: SqlDialect | "auto") => void;
}

export const QueryToolbar = memo(function QueryToolbar({
  isExecuting,
  hasQuery,
  showResults,
  showOutline = false,
  runLabel = "Run",
  executeHint,
  beautifyHint: _beautifyHint,
  dialect = "auto",
  detectedDialect,
  onExecute,
  onExecuteAll,
  onCancel,
  onBeautify,
  onToggleResults,
  onToggleOutline,
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
            <IconLayoutRows className="h-3.5 w-3.5" />
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
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5">
          {/* Outline toggle button - hidden on narrow containers */}
          {onToggleOutline && (
            <Button
              size="sm"
              variant={showOutline ? "secondary" : "ghost"}
              onClick={onToggleOutline}
              className="!h-6 text-xs gap-1 hidden @[500px]/toolbar:flex !px-2"
              title="Toggle Query Outline"
            >
              <IconBinaryTree className="h-3 w-3" />
              <span>Outline</span>
            </Button>
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

              {/* Outline toggle */}
              {onToggleOutline && (
                <DropdownMenuItem onClick={onToggleOutline} className="text-xs">
                  <IconBinaryTree className="h-3 w-3 mr-2" />
                  {showOutline ? "Hide Outline" : "Show Outline"}
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
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
