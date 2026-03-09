import { memo, useMemo, type ComponentProps } from "react";
import { IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/CodeEditor";
import { DocumentDataGrid } from "@/components/DataGrid";
import { cn } from "@/lib/utils";
import {
  extractMongoResultDocuments,
  formatMongoExecutionResult,
  type MongoExecutionResult,
} from "./mongo-result-state";
import type { MongoResultViewMode } from "./MongoQueryToolbar";

interface MongoResultViewerProps {
  result: MongoExecutionResult | null;
  viewMode: MongoResultViewMode;
  connectionId: string;
  database: string;
  gridId: string;
  executionTime: number | null;
  onClearResults: () => void;
  className?: string;
}

function getResultLabel(result: MongoExecutionResult | null): string {
  if (!result) {
    return "Results";
  }

  if (result.collection) {
    return result.collection;
  }

  switch (result.kind) {
    case "documents":
      return "Documents";
    case "scalar":
      return "Scalar result";
    case "mutation":
      return "Mutation result";
    case "error":
      return "Error";
    case "command":
    default:
      return "Command result";
  }
}

export const MongoResultViewer = memo(function MongoResultViewer({
  result,
  viewMode,
  connectionId,
  database,
  gridId,
  executionTime,
  onClearResults,
  className,
}: MongoResultViewerProps) {
  const documents = useMemo(
    () => (result ? extractMongoResultDocuments(result) : null),
    [result],
  );
  const canRenderData = viewMode === "data" && result?.supportsDataView && documents;
  const formattedResult = useMemo(
    () => (result ? formatMongoExecutionResult(result) : ""),
    [result],
  );

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">
            {getResultLabel(result)}
          </span>
          {executionTime !== null && (
            <span className="text-xs text-muted-foreground">
              {executionTime.toFixed(2)}ms
            </span>
          )}
          {documents && (
            <span className="text-xs text-muted-foreground">
              {documents.length.toLocaleString()} docs
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClearResults}
          disabled={!result}
          className="!h-6 text-xs gap-1 !px-2 text-muted-foreground hover:text-foreground"
        >
          <IconTrash className="h-3.5 w-3.5" />
          <span>Clear results</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {!result ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            Run a query to see results
          </div>
        ) : canRenderData ? (
          <DocumentDataGrid
            {...({
              mode: "result",
              gridId,
              connectionId,
              database,
              documents,
              collection: result.collection,
              className: "h-full",
            } as ComponentProps<typeof DocumentDataGrid>)}
          />
        ) : (
          <div className="flex h-full flex-col">
            {viewMode === "data" && !result.supportsDataView && (
              <div className="border-b bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                Data view is unavailable for this result.
              </div>
            )}
            <CodeEditor
              value={formattedResult}
              language="json"
              readOnly={true}
              lineNumbers={true}
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  );
});
