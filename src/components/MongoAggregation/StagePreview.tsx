import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  IconLoader2,
  IconPlayerPlay,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DocumentDataGrid } from "@/components/DataGrid";
import { CodeEditor } from "@/components/CodeEditor";
import {
  extractMongoResultDocuments,
  formatMongoExecutionResult,
  normalizeMongoResult,
  type MongoExecutionResult,
} from "@/components/MongoQueryPanel/mongo-result-state";
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
  const [result, setResult] = useState<MongoExecutionResult | null>(null);
  const [viewMode, setViewMode] = useState<MongoResultViewMode>("data");
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const documents = useMemo(
    () => (result ? extractMongoResultDocuments(result) : null),
    [result],
  );

  const formattedResult = useMemo(
    () => (result ? formatMongoExecutionResult(result) : ""),
    [result],
  );

  // Local search: filter documents by search query
  const filteredDocuments = useMemo(() => {
    if (!documents || !searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter((doc) =>
      JSON.stringify(doc).toLowerCase().includes(q),
    );
  }, [documents, searchQuery]);

  const docCount = documents?.length ?? 0;
  const filteredCount = filteredDocuments?.length ?? 0;
  const isFiltered = searchQuery.trim().length > 0 && filteredCount !== docCount;

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
      const docs = await adapter.aggregate(
        collection,
        parsed.pipeline,
        database,
      );

      if (abortRef.current !== runId) return;

      setResult(
        normalizeMongoResult({
          operation: "aggregate",
          result: docs,
          collection,
        }),
      );
      setViewMode("data");
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
      setViewMode("json");
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

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  const canRenderData = viewMode === "data" && result?.supportsDataView && filteredDocuments;

  return (
    <div className="flex h-full min-h-0 flex-col rounded border">
      {/* Single merged header */}
      <div className="flex flex-none items-center gap-2 border-b px-2 py-1">
        {/* Stage label + stats */}
        <span className="text-xs font-medium truncate min-w-0">
          {isFullPipeline
            ? `Pipeline · ${totalStages}`
            : `Stage ${selectedStageIndex + 1} · ${stageType}`}
        </span>

        {executionTime !== null && (
          <span className="text-[10px] text-muted-foreground flex-none">
            {executionTime}ms
          </span>
        )}

        {docCount > 0 && (
          <span className="text-[10px] text-muted-foreground flex-none">
            {isFiltered
              ? `${filteredCount.toLocaleString()}/${docCount.toLocaleString()}`
              : docCount.toLocaleString()}{" "}
            docs
          </span>
        )}

        {loading && (
          <IconLoader2 className="h-3 w-3 flex-none animate-spin text-muted-foreground" />
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search toggle */}
        <Button
          size="sm"
          variant={showSearch ? "secondary" : "ghost"}
          className="h-5 w-5 p-0"
          onClick={() => {
            setShowSearch((prev) => !prev);
            if (showSearch) setSearchQuery("");
          }}
        >
          <IconSearch className="h-3 w-3" />
        </Button>

        {/* Auto-preview toggle */}
        {!autoPreview && (
          <Button
            size="sm"
            variant="outline"
            className="h-5 gap-1 px-1.5 text-[10px]"
            onClick={() => void runPreview()}
            disabled={loading}
          >
            <IconPlayerPlay className="h-2.5 w-2.5" />
          </Button>
        )}

        <div className="flex items-center gap-1">
          <Switch
            id="auto-preview"
            checked={autoPreview}
            onCheckedChange={onAutoPreviewChange}
            className="scale-[0.6] origin-right"
          />
          <Label htmlFor="auto-preview" className="text-[10px] text-muted-foreground cursor-pointer leading-none">
            Auto
          </Label>
        </div>

        {/* Data/JSON toggle */}
        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as MongoResultViewMode)}
        >
          <TabsList size="xs">
            <TabsTrigger value="data" size="xs">
              Data
            </TabsTrigger>
            <TabsTrigger value="json" size="xs">
              JSON
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search bar (collapsible) */}
      {showSearch && (
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <IconSearch className="h-3 w-3 flex-none text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search results..."
            className="h-5 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          {searchQuery && (
            <Button
              size="sm"
              variant="ghost"
              className="h-4 w-4 p-0"
              onClick={() => setSearchQuery("")}
            >
              <IconX className="h-2.5 w-2.5" />
            </Button>
          )}
        </div>
      )}

      {/* Error display */}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* Empty state */}
      {!result && !loading && !error ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {autoPreview
            ? "Select a stage to preview."
            : "Click a stage, then press play."}
        </div>
      ) : null}

      {/* Results — rendered directly, no MongoResultViewer wrapper */}
      {(result || loading) ? (
        <div className="min-h-0 flex-1">
          {canRenderData ? (
            <DocumentDataGrid
              {...({
                mode: "result",
                gridId: `mongo-agg-preview:${tabId}:${selectedStageIndex}`,
                connectionId,
                database,
                documents: filteredDocuments,
                collection: result.collection,
                className: "h-full",
              } as ComponentProps<typeof DocumentDataGrid>)}
            />
          ) : result ? (
            <div className="flex h-full flex-col">
              {viewMode === "data" && !result.supportsDataView && (
                <div className="border-b bg-muted/10 px-3 py-1.5 text-xs text-muted-foreground">
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
