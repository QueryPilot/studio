import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconPlayerPlay } from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MongoResultViewer } from "@/components/MongoQueryPanel/MongoResultViewer";
import { normalizeMongoResult } from "@/components/MongoQueryPanel/mongo-result-state";
import type { MongoResultViewMode } from "@/components/MongoQueryPanel/MongoQueryToolbar";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { detectStageType, parseAggregationStages } from "./utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StagePreviewProps {
  connectionId: string;
  database: string;
  collection: string;
  stages: string[];
  stageEnabled: boolean[];
  selectedStageIndex: number;
  totalStages: number;
  tabId: string;
  autoPreview: boolean;
  onAutoPreviewChange: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StagePreview = memo(function StagePreview({
  connectionId,
  database,
  collection,
  stages,
  stageEnabled,
  selectedStageIndex,
  totalStages,
  tabId,
  autoPreview,
  onAutoPreviewChange,
}: StagePreviewProps) {
  const [result, setResult] = useState<ReturnType<typeof normalizeMongoResult> | null>(null);
  const [resultViewMode, setResultViewMode] = useState<MongoResultViewMode>("data");
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(0);

  // Build the partial pipeline: only enabled stages up to selectedStageIndex
  const partialStages = useMemo(() => {
    const slice = stages.slice(0, selectedStageIndex + 1);
    return slice.filter((_, i) => stageEnabled[i] !== false);
  }, [stages, stageEnabled, selectedStageIndex]);

  const stageType = useMemo(() => {
    const stageJson = stages[selectedStageIndex];
    return stageJson ? detectStageType(stageJson) : "$stage";
  }, [stages, selectedStageIndex]);

  const isFullPipeline = selectedStageIndex >= totalStages - 1;

  const runPreview = useCallback(async () => {
    const parsed = parseAggregationStages(partialStages);
    if (!parsed.ok) {
      setError(parsed.error);
      setResult(null);
      setExecutionTime(null);
      setLoading(false);
      return;
    }

    if (parsed.pipeline.length === 0) {
      setError(null);
      setResult(null);
      setExecutionTime(null);
      setLoading(false);
      return;
    }

    const runId = ++abortRef.current;
    setLoading(true);
    setError(null);

    const start = performance.now();
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const documents = await adapter.aggregate(
        collection,
        parsed.pipeline,
        database,
      );

      if (abortRef.current !== runId) return;

      setResult(
        normalizeMongoResult({
          operation: "aggregate",
          result: documents,
          collection,
        }),
      );
      setResultViewMode("data");
      setExecutionTime(Math.round(performance.now() - start));
    } catch (runError) {
      if (abortRef.current !== runId) return;

      setResult(
        normalizeMongoResult({
          operation: "aggregate",
          error: runError,
          collection,
        }),
      );
      setResultViewMode("json");
      setExecutionTime(Math.round(performance.now() - start));
    } finally {
      if (abortRef.current === runId) {
        setLoading(false);
      }
    }
  }, [collection, connectionId, database, partialStages]);

  // Auto-preview: debounced execution when enabled
  useEffect(() => {
    if (!autoPreview) return;

    const timer = setTimeout(() => {
      void runPreview();
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [autoPreview, runPreview]);

  // Header label
  const headerLabel = isFullPipeline
    ? `Full Pipeline · ${totalStages} stage${totalStages === 1 ? "" : "s"}`
    : `Stage ${selectedStageIndex + 1} Output · ${stageType}`;

  return (
    <div className="flex h-full min-h-0 flex-col rounded border">
      {/* Header */}
      <div className="flex flex-none items-center justify-between gap-2 border-b bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">
            {headerLabel}
          </span>
          {loading && (
            <IconLoader2 className="h-3.5 w-3.5 flex-none animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex items-center gap-2 flex-none">
          {!autoPreview && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => void runPreview()}
              disabled={loading}
            >
              <IconPlayerPlay className="h-3 w-3" />
              Preview
            </Button>
          )}

          <div className="flex items-center gap-1.5">
            <Switch
              id="auto-preview"
              checked={autoPreview}
              onCheckedChange={onAutoPreviewChange}
              className="scale-75"
            />
            <Label htmlFor="auto-preview" className="text-[10px] text-muted-foreground cursor-pointer">
              Auto
            </Label>
          </div>

          <Tabs
            value={resultViewMode}
            onValueChange={(value) => {
              setResultViewMode(value as MongoResultViewMode);
            }}
          >
            <TabsList className="h-6 p-0.5">
              <TabsTrigger value="data" className="h-5 px-2 text-xs">
                Data
              </TabsTrigger>
              <TabsTrigger value="json" className="h-5 px-2 text-xs">
                JSON
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Error display */}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Empty state when auto-preview is off and no result yet */}
      {!result && !loading && !error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {autoPreview
            ? "Select a stage to preview its output."
            : "Click a stage, then click Preview to see its output."}
        </div>
      ) : null}

      {/* Results */}
      {(result || loading) ? (
        <div className="min-h-0 flex-1">
          <MongoResultViewer
            result={result}
            viewMode={resultViewMode}
            connectionId={connectionId}
            database={database}
            gridId={`mongo-agg-preview:${tabId}:${selectedStageIndex}`}
            executionTime={executionTime}
            onClearResults={() => {
              setResult(null);
              setExecutionTime(null);
            }}
            className="h-full"
          />
        </div>
      ) : null}
    </div>
  );
});
