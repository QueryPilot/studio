import {
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { MongoResultViewer } from "@/components/MongoQueryPanel/MongoResultViewer";
import { normalizeMongoResult } from "@/components/MongoQueryPanel/mongo-result-state";
import type { MongoResultViewMode } from "@/components/MongoQueryPanel/MongoQueryToolbar";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";

import type {
  MongoWorkbenchState,
} from "@/types/mongoWorkbench";


type AggregationParseResult =
  | { ok: true; pipeline: object[] }
  | { ok: false; error: string };

const DEFAULT_STAGE_TEMPLATES: Record<string, string> = {
  Match: JSON.stringify({ $match: {} }, null, 2),
  Group: JSON.stringify({ $group: { _id: "$field", count: { $sum: 1 } } }, null, 2),
  Sort: JSON.stringify({ $sort: { createdAt: -1 } }, null, 2),
  Project: JSON.stringify({ $project: { _id: 0 } }, null, 2),
  Limit: JSON.stringify({ $limit: 50 }, null, 2),
};

function parseAggregationStages(stages: string[]): AggregationParseResult {
  const pipeline: object[] = [];

  for (let index = 0; index < stages.length; index += 1) {
    const stageText = stages[index]?.trim() ?? "";
    if (!stageText) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stageText);
    } catch (error) {
      return {
        ok: false,
        error: `Stage ${index + 1} has invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Stage ${index + 1} must be a JSON object`,
      };
    }

    pipeline.push(parsed);
  }

  return { ok: true, pipeline };
}

function swapStages(stages: string[], fromIndex: number, toIndex: number): string[] {
  const fromValue = stages[fromIndex];
  const toValue = stages[toIndex];

  if (fromValue === undefined || toValue === undefined) {
    return stages;
  }

  const nextStages = [...stages];
  nextStages[fromIndex] = toValue;
  nextStages[toIndex] = fromValue;
  return nextStages;
}


export const MongoAggregationView = memo(function MongoAggregationView({
  connectionId,
  database,
  collection,
  tabId,
  workbenchState,
  onWorkbenchStateChange,
  onOpenExplain,
}: {
  connectionId: string;
  database: string;
  collection: string;
  tabId: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  onOpenExplain: () => void;
}) {
  const [result, setResult] = useState<ReturnType<typeof normalizeMongoResult> | null>(null);
  const [resultViewMode, setResultViewMode] = useState<MongoResultViewMode>("data");
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages = useMemo(
    () => workbenchState.aggregationStages ?? [],
    [workbenchState.aggregationStages],
  );
  const parsed = useMemo(() => parseAggregationStages(stages), [stages]);

  const updateStages = useCallback(
    (nextStages: string[]) => {
      onWorkbenchStateChange({ aggregationStages: nextStages });
    },
    [onWorkbenchStateChange],
  );

  const runAggregation = useCallback(async () => {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    const start = performance.now();
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const documents = await adapter.aggregate(
        collection,
        parsed.pipeline,
        database,
      );
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
      const normalized = normalizeMongoResult({
        operation: "aggregate",
        error: runError,
        collection,
      });
      setResult(normalized);
      setResultViewMode("json");
      setExecutionTime(Math.round(performance.now() - start));
    }
  }, [collection, connectionId, database, parsed]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-3 p-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(DEFAULT_STAGE_TEMPLATES).map(([label, template]) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            onClick={() => {
              updateStages([...stages, template]);
            }}
          >
            Add {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            updateStages(stages.filter((stage) => stage.trim().length > 0));
          }}
        >
          Trim Empty
        </Button>
        <Button size="sm" onClick={() => void runAggregation()}>
          Run
        </Button>
        <Button size="sm" variant="outline" onClick={onOpenExplain}>
          Explain
        </Button>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <Card className="min-h-0">
          <CardHeader className="pb-0">
            <CardTitle>Pipeline stages</CardTitle>
            <CardDescription>
              Build and reorder stages before running the draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
          <div className="space-y-2">
            {stages.length === 0 ? (
              <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                Add a stage to begin building a pipeline.
              </div>
            ) : (
              stages.map((stage, index) => (
                <div key={`${index}-${stage.length}`} className="rounded border p-2">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Stage {index + 1}</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (index === 0) return;
                          updateStages(swapStages(stages, index, index - 1));
                        }}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (index >= stages.length - 1) return;
                          updateStages(swapStages(stages, index, index + 1));
                        }}
                      >
                        Down
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          updateStages(
                            stages.filter((_, stageIndex) => stageIndex !== index),
                          );
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={stage}
                    onChange={(event) => {
                      const nextStages = [...stages];
                      nextStages[index] = event.target.value;
                      updateStages(nextStages);
                    }}
                    className="min-h-[132px] font-mono text-xs"
                  />
                </div>
              ))
            )}
          </div>
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="pb-0">
            <CardTitle>Combined pipeline</CardTitle>
            <CardDescription>
              Review the final pipeline payload before execution or explain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <pre className="min-h-[220px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
              {parsed.ok
                ? JSON.stringify(parsed.pipeline, null, 2)
                : parsed.error}
            </pre>
          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="min-h-0 overflow-hidden rounded border">
        <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
          <div className="text-sm font-semibold">Results</div>
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
        <MongoResultViewer
          result={result}
          viewMode={resultViewMode}
          connectionId={connectionId}
          database={database}
          gridId={`mongo-aggregation:${tabId}`}
          executionTime={executionTime}
          onClearResults={() => {
            setResult(null);
            setExecutionTime(null);
          }}
          className="h-full"
        />
      </div>
    </div>
  );
});

// MongoCollectionWorkbench shell has moved to ./index.tsx
// MongoExplainView has moved to @/components/MongoExplain
