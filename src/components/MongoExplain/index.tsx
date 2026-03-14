import { memo, useCallback, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type {
  MongoExplainRequest,
  MongoExplainResult,
} from "@/adapters/types/mongodb";
import { parseDocumentFilter } from "@/utils/documentFilterParser";
import type { MongoWorkbenchState } from "@/types/mongoWorkbench";

import { getExplainSummary, getSortObject } from "./utils";
import { ExplainTree } from "./ExplainTree";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type AggregationParseResult =
  | { ok: true; pipeline: object[] }
  | { ok: false; error: string };

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

// ---------------------------------------------------------------------------
// CodeMirror extensions for read-only JSON display
// ---------------------------------------------------------------------------

const JSON_READONLY_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  EditorView.editable.of(false),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "12px",
    },
  }),
];

// ---------------------------------------------------------------------------
// Local StatCard component
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2 bg-muted/20">
      <CardHeader className="gap-0.5">
        <CardDescription className="text-[11px] uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MongoExplainViewProps {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  sortGridId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MongoExplainView = memo(function MongoExplainView({
  connectionId,
  database,
  collection,
  workbenchState,
  onWorkbenchStateChange,
  sortGridId,
}: MongoExplainViewProps) {
  const [result, setResult] = useState<MongoExplainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { resolvedTheme } = useTheme();

  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[sortGridId]?.sortColumns ?? [],
  );

  // ---- Run explain -------------------------------------------------------

  const runExplain = useCallback(async () => {
    setLoading(true);
    setError(null);

    let request: MongoExplainRequest;
    if (workbenchState.explainSource === "aggregation") {
      const parsedPipeline = parseAggregationStages(
        workbenchState.aggregationStages ?? [],
      );
      if (!parsedPipeline.ok) {
        setLoading(false);
        setError(parsedPipeline.error);
        return;
      }
      request = {
        mode: "aggregate",
        pipeline: parsedPipeline.pipeline,
      };
    } else {
      const filterText = workbenchState.filterText?.trim() ?? "";
      let filter: Record<string, unknown> | undefined;
      if (filterText) {
        const parsedFilter = parseDocumentFilter(filterText);
        if (!parsedFilter.success) {
          setLoading(false);
          setError(parsedFilter.error || "Invalid filter");
          return;
        }
        if (parsedFilter.filter?.mode === "search") {
          setLoading(false);
          setError(
            "Search-mode filters run client-side only. Convert the Data tab filter to query mode to profile it.",
          );
          return;
        }
        filter = parsedFilter.filter?.mongoQuery;
      }

      request = {
        mode: "find",
        filter,
        sort: getSortObject(sortColumns),
      };
    }

    try {
      const adapter = new MongoDBAdapter(connectionId);
      const explain = await adapter.explainCollectionOperation(
        collection,
        request,
        database,
      );
      setResult(explain);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [
    collection,
    connectionId,
    database,
    sortColumns,
    workbenchState.aggregationStages,
    workbenchState.explainSource,
    workbenchState.filterText,
  ]);

  // ---- Derived data ------------------------------------------------------

  const summary = useMemo(() => getExplainSummary(result), [result]);

  const queryPlanner =
    result && typeof result === "object" && result.queryPlanner
      ? (result.queryPlanner as Record<string, unknown>)
      : undefined;

  const executionStages =
    result && typeof result === "object" && result.executionStats
      ? ((result.executionStats as Record<string, unknown>)
          .executionStages as Record<string, unknown> | undefined)
      : undefined;

  const rawJson = useMemo(
    () =>
      result
        ? JSON.stringify(result, null, 2)
        : "Run explain to inspect the raw response.",
    [result],
  );

  // ---- CodeMirror theme --------------------------------------------------

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  const cmExtensions = useMemo(
    () => [...JSON_READONLY_EXTENSIONS, ...themeExtensions],
    [themeExtensions],
  );

  // ---- Render ------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-none items-center gap-4 border-b px-3 py-2">
        <Button size="sm" onClick={() => void runExplain()} disabled={loading}>
          {loading ? "Running\u2026" : "Run Explain"}
        </Button>

        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="mongo-explain-source"
            className="text-xs text-muted-foreground"
          >
            Source
          </Label>
          <Select
            value={workbenchState.explainSource ?? "data"}
            onValueChange={(value) => {
              onWorkbenchStateChange({
                explainSource: value as MongoWorkbenchState["explainSource"],
              });
            }}
          >
            <SelectTrigger
              id="mongo-explain-source"
              size="sm"
              className="w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="data">Current Data Query</SelectItem>
              <SelectItem value="aggregation">Aggregation Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Stats bar */}
      {summary.length > 0 ? (
        <div className="flex-none border-b px-3 py-2">
          <div className="grid gap-2 md:grid-cols-5">
            {summary.map((item) => (
              <StatCard key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Visual / Raw JSON tabs */}
      <Tabs defaultValue="visual" className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none border-b px-3 pt-1">
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visual" className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="gap-2">
              <CardHeader className="pb-0">
                <CardTitle>Query planner</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {queryPlanner ? (
                  <ExplainTree label="queryPlanner" data={queryPlanner} />
                ) : (
                  <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                    No planner tree available yet.
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="gap-2">
              <CardHeader className="pb-0">
                <CardTitle>Execution stages</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {executionStages ? (
                  <ExplainTree label="executionStages" data={executionStages} />
                ) : (
                  <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                    No execution stage tree available.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="raw" className="min-h-0 flex-1 overflow-hidden">
          <CodeMirror
            value={rawJson}
            extensions={cmExtensions}
            theme="none"
            height="100%"
            className="h-full"
            readOnly
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: false,
              defaultKeymap: false,
              searchKeymap: false,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
});
