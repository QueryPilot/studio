import type { RefObject } from "react";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import type { SqlDialect } from "@/components/CodeEditor/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import type { QueryResult } from "@/stores/tabStateStore";
import type { ViewMode } from "@/types/viewMode";
import { IconX } from "@tabler/icons-react";
import { QueryEditor } from "./QueryEditor";
import { QueryOutline } from "./QueryOutline";
import { QueryToolbar } from "./QueryToolbar";
import { ResultViewer } from "./ResultViewer";
import type { BatchStatementResult } from "./query-batch-orchestrator";
import type { QueryExecutionStatus } from "./queryExecutionState";

interface QueryPanelLayoutProps {
  panelContainerRef: RefObject<HTMLDivElement | null>;
  panelClassName?: string;
  onPanelMouseDown: () => void;
  inTransaction: boolean;
  editorRef: RefObject<SqlEditorRef | null>;
  effectiveConnectionId: string;
  database: string;
  schema?: string;
  dbType: string;
  query: string;
  onEditorChange: (value: string) => void;
  onSelectionChange: (selection: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
  selectedDialect: SqlDialect | "auto";
  onDialectDetected: (dialect: SqlDialect) => void;
  hasQuery: boolean;
  showResults: boolean;
  showOutline: boolean;
  focused: boolean;
  detectedDialect: SqlDialect;
  runButtonLabel: string;
  onExecuteAll: () => void;
  onCancel: () => void;
  onBeautify: () => void;
  onToggleResults: () => void;
  onToggleOutline: () => void;
  onDialectChange: (dialect: SqlDialect | "auto") => void;
  deferredQuery: string;
  onCloseOutline: () => void;
  batchResults: BatchStatementResult[];
  activeBatchResultIndex: number;
  onActiveBatchResultChange: (index: number) => void;
  isBatchExecuting: boolean;
  displayedResult: QueryResult | null;
  isStreaming: boolean;
  executionStatus: QueryExecutionStatus;
  queryGridId: string;
  activeResultMode: ViewMode;
  activeSupportedModes: ViewMode[];
  onModeChange: (mode: ViewMode) => void;
  onFixWithAI: (errorMessage: string) => void;
  refreshNotice?: string;
  onRefreshResults?: () => void;
  showplanMode?: string | null;
  resultTabGroupId?: string;
  isTabSwitching?: boolean;
}

function getStatementKeyword(statement: string): string {
  // Strip line comments and block comments before extracting the keyword
  const withoutComments = statement
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!withoutComments) return "Statement";
  const [first] = withoutComments.split(" ");
  return first ? first.toUpperCase() : "Statement";
}

export function QueryPanelLayout({
  panelContainerRef,
  panelClassName,
  onPanelMouseDown,
  inTransaction,
  editorRef,
  effectiveConnectionId,
  database,
  schema,
  dbType,
  query,
  onEditorChange,
  onSelectionChange,
  onExecute,
  isExecuting,
  selectedDialect,
  onDialectDetected,
  hasQuery,
  showResults,
  showOutline,
  focused,
  detectedDialect,
  runButtonLabel,
  onExecuteAll,
  onCancel,
  onBeautify,
  onToggleResults,
  onToggleOutline,
  onDialectChange,
  deferredQuery,
  onCloseOutline,
  batchResults,
  activeBatchResultIndex,
  onActiveBatchResultChange,
  isBatchExecuting,
  displayedResult,
  isStreaming,
  executionStatus,
  queryGridId,
  activeResultMode,
  activeSupportedModes,
  onModeChange,
  onFixWithAI,
  refreshNotice,
  onRefreshResults,
  showplanMode,
  resultTabGroupId = "query-result-view-mode",
  isTabSwitching = false,
}: QueryPanelLayoutProps) {
  const hasModeTabs = activeSupportedModes.length > 0;
  const showResultHeader = batchResults.length > 0 || hasModeTabs;
  const effectiveActiveBatchIndex =
    activeBatchResultIndex < batchResults.length
      ? activeBatchResultIndex
      : batchResults.length - 1;
  const tabLabelByMode: Record<ViewMode, string> = {
    table: "Table",
    json: "JSON",
    explain: "Plan",
    raw: "Raw",
    stats: "Stats",
  };

  return (
    <div
      ref={panelContainerRef}
      className={cn("flex flex-col h-full", panelClassName)}
      onMouseDown={onPanelMouseDown}
    >
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full rounded-xl overflow-hidden"
          autoSaveId="query-panel-outer"
        >
          <ResizablePanel
            id="qp-editor-wrapper"
            defaultSize="100"
            minSize="30"
            className="rounded-xl overflow-hidden"
          >
            <ResizablePanelGroup
              orientation="vertical"
              className="h-full"
              autoSaveId="query-panel-editor-results"
            >
              <ResizablePanel
                id="qp-editor"
                defaultSize="50"
                minSize="20"
                className="border-none"
              >
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="h-full"
                  autoSaveId="query-panel-editor-outline"
                >
                  <ResizablePanel
                    id="qp-sql-editor"
                    defaultSize="75"
                    minSize="30"
                    className="flex flex-col relative"
                  >
                    <QueryEditor
                      ref={editorRef}
                      connectionId={effectiveConnectionId}
                      database={database}
                      schema={schema}
                      dbType={dbType}
                      value={query}
                      onChange={onEditorChange}
                      onSelectionChange={onSelectionChange}
                      onExecute={onExecute}
                      isExecuting={isExecuting}
                      height="100%"
                      dialectOverride={
                        selectedDialect === "auto" ? undefined : selectedDialect
                      }
                      onDialectDetected={onDialectDetected}
                    />
                    <QueryToolbar
                      isExecuting={isExecuting}
                      hasQuery={hasQuery}
                      showResults={showResults}
                      showOutline={showOutline}
                      dialect={selectedDialect}
                      detectedDialect={detectedDialect}
                      runLabel={runButtonLabel}
                      onExecute={onExecute}
                      onExecuteAll={onExecuteAll}
                      onCancel={onCancel}
                      onBeautify={onBeautify}
                      onToggleResults={onToggleResults}
                      onToggleOutline={onToggleOutline}
                      onDialectChange={onDialectChange}
                      showplanMode={showplanMode}
                      inTransaction={inTransaction}
                    />
                  </ResizablePanel>

                  {showOutline && (
                    <>
                      <ResizableHandle className="bg-border !w-0.5 hover:bg-primary/50 transition-colors" />
                      <ResizablePanel
                        id="qp-outline"
                        defaultSize="25"
                        minSize="15"
                        maxSize="50"
                      >
                        <div className="h-full flex flex-col overflow-hidden bg-muted/30">
                          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
                            <span className="text-xs font-medium text-muted-foreground">
                              Query Outline
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={onCloseOutline}
                              title="Close Outline"
                            >
                              <IconX className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-auto">
                            <QueryOutline
                              sql={deferredQuery}
                              dialect={
                                selectedDialect === "auto"
                                  ? detectedDialect
                                  : selectedDialect
                              }
                              onNavigate={(position) => {
                                editorRef.current?.setCursorPosition(position);
                              }}
                            />
                          </div>
                        </div>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>

              {showResults && (
                <>
                  <div className="px-1">
                    <ResizableHandle className="!h-1 rounded-xl" />
                  </div>

                  <ResizablePanel id="qp-results" defaultSize="50" minSize="20">
                    <div className="flex flex-col h-full">
                      {showResultHeader && (
                        <div className="shrink-0 px-2 py-1 bg-muted/40">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              {batchResults.length > 0 && (
                                <div className="flex items-center gap-1 overflow-x-auto">
                                  {batchResults.map((entry, index) => (
                                    <button
                                      key={`${entry.statementIndex}-${index}`}
                                      type="button"
                                      onClick={() => {
                                        onActiveBatchResultChange(index);
                                      }}
                                      className={cn(
                                        "flex items-center gap-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap",
                                        effectiveActiveBatchIndex === index
                                          ? "border-primary bg-primary/10 text-primary"
                                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "h-1.5 w-1.5 rounded-full",
                                          entry.status === "success" &&
                                            "bg-emerald-500",
                                          entry.status === "error" &&
                                            "bg-red-500",
                                          entry.status === "skipped" &&
                                            "bg-amber-500",
                                        )}
                                      />
                                      <span>
                                        #{entry.statementIndex}{" "}
                                        {entry.showplanLabel ??
                                          getStatementKeyword(entry.statement)}
                                      </span>
                                    </button>
                                  ))}
                                  {isBatchExecuting && (
                                    <span className="text-[11px] text-muted-foreground px-2">
                                      Running...
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {hasModeTabs && (
                              <Tabs
                                value={activeResultMode}
                                onValueChange={(value) => {
                                  onModeChange(value as ViewMode);
                                }}
                                enableShortcuts={true}
                                tabGroupId={resultTabGroupId}
                                focused={focused}
                                enableGlobalShortcuts={false}
                              >
                                <TabsList className="!h-7 !p-0.5">
                                  {activeSupportedModes.map((mode, index) => (
                                    <TabsTrigger
                                      key={mode}
                                      value={mode}
                                      className="text-xs !h-6 !px-2"
                                      tabIndex={index}
                                    >
                                      {tabLabelByMode[mode]}
                                    </TabsTrigger>
                                  ))}
                                </TabsList>
                              </Tabs>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-h-0 relative">
                        {isTabSwitching && (
                          <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center backdrop-blur-[1px] transition-opacity">
                            <div className="text-xs text-muted-foreground animate-pulse">
                              Loading result...
                            </div>
                          </div>
                        )}
                        <ResultViewer
                          result={displayedResult}
                          isLoading={isExecuting}
                          isStreaming={isStreaming}
                          executionStatus={executionStatus}
                          connectionId={effectiveConnectionId}
                          database={database}
                          databaseType={dbType}
                          height="100%"
                          gridId={queryGridId}
                          viewMode={activeResultMode}
                          cursorSetupMs={displayedResult?.cursorSetupMs}
                          totalStreamingMs={displayedResult?.totalStreamingMs}
                          fetchCount={displayedResult?.fetchCount}
                          networkMs={displayedResult?.networkMs}
                          conversionMs={displayedResult?.conversionMs}
                          ipcSendMs={displayedResult?.ipcSendMs}
                          onFixWithAI={onFixWithAI}
                          refreshNotice={refreshNotice}
                          onRefreshResults={onRefreshResults}
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
