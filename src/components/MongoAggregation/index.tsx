import { memo, useCallback, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  IconPlayerPlay,
  IconFilter,
  IconCode,
  IconLayoutList,
  IconPlus,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MongoResultViewer } from "@/components/MongoQueryPanel/MongoResultViewer";
import { normalizeMongoResult } from "@/components/MongoQueryPanel/mongo-result-state";
import type { MongoResultViewMode } from "@/components/MongoQueryPanel/MongoQueryToolbar";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type { MongoWorkbenchState } from "@/types/mongoWorkbench";
import { StageCard } from "./StageCard";
import { StagePreview } from "./StagePreview";
import { PipelineCodeView } from "./PipelineCodeView";
import { nanoid } from "nanoid";
import {
  DEFAULT_STAGE_TEMPLATES,
  parseAggregationStages,
} from "./utils";

// ---------------------------------------------------------------------------
// Quick-add stage buttons shown in the toolbar
// ---------------------------------------------------------------------------

const QUICK_ADD_STAGES = ["$match", "$group", "$sort", "$project", "$limit"];

const MORE_STAGES = Object.keys(DEFAULT_STAGE_TEMPLATES).filter(
  (key) => !QUICK_ADD_STAGES.includes(key),
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MongoAggregationViewProps {
  connectionId: string;
  database: string;
  collection: string;
  tabId: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  onOpenExplain: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MongoAggregationView = memo(function MongoAggregationView({
  connectionId,
  database,
  collection,
  tabId,
  workbenchState,
  onWorkbenchStateChange,
  onOpenExplain,
}: MongoAggregationViewProps) {
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [fullResult, setFullResult] = useState<ReturnType<typeof normalizeMongoResult> | null>(null);
  const [fullResultViewMode, setFullResultViewMode] = useState<MongoResultViewMode>("data");
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // -- Derived state ---------------------------------------------------------

  const stages = useMemo(
    () => workbenchState.aggregationStages ?? [],
    [workbenchState.aggregationStages],
  );

  const stageEnabled = useMemo(
    () => workbenchState.aggregationStageEnabled ?? [],
    [workbenchState.aggregationStageEnabled],
  );

  const viewMode = workbenchState.aggregationViewMode ?? "visual";

  // Stable IDs for DnD — persist across reorders so React doesn't remount StageCards.
  // Kept in state (not a ref) so it participates in rendering without violating lint rules.
  const [stageKeys, setStageKeys] = useState<string[]>(() =>
    stages.map(() => nanoid(8)),
  );

  // Sync length: grow with new IDs when stages are added externally, trim when removed.
  const stageIds = useMemo(() => {
    if (stageKeys.length === stages.length) return stageKeys;
    if (stageKeys.length < stages.length) {
      const grown = [
        ...stageKeys,
        ...Array.from({ length: stages.length - stageKeys.length }, () => nanoid(8)),
      ];
      return grown;
    }
    return stageKeys.slice(0, stages.length);
  }, [stages.length, stageKeys]);

  // -- Callbacks -------------------------------------------------------------

  const updateStages = useCallback(
    (nextStages: string[], nextEnabled?: boolean[]) => {
      const updates: Partial<MongoWorkbenchState> = {
        aggregationStages: nextStages,
      };
      if (nextEnabled !== undefined) {
        updates.aggregationStageEnabled = nextEnabled;
      }
      onWorkbenchStateChange(updates);
    },
    [onWorkbenchStateChange],
  );

  const addStage = useCallback(
    (template: string) => {
      const nextStages = [...stages, template];
      const nextEnabled = [...stageEnabled, true];
      setStageKeys((prev) => [...prev, nanoid(8)]);
      updateStages(nextStages, nextEnabled);
      setSelectedStageIndex(nextStages.length - 1);
    },
    [stages, stageEnabled, updateStages],
  );

  const handleStageJsonChange = useCallback(
    (index: number, json: string) => {
      const nextStages = [...stages];
      nextStages[index] = json;
      updateStages(nextStages);
    },
    [stages, updateStages],
  );

  const handleStageEnabledChange = useCallback(
    (index: number, enabled: boolean) => {
      const nextEnabled = [...stageEnabled];
      nextEnabled[index] = enabled;
      onWorkbenchStateChange({ aggregationStageEnabled: nextEnabled });
    },
    [stageEnabled, onWorkbenchStateChange],
  );

  const handleDeleteStage = useCallback(
    (index: number) => {
      const nextStages = stages.filter((_, i) => i !== index);
      const nextEnabled = stageEnabled.filter((_, i) => i !== index);
      setStageKeys((prev) => prev.filter((_, i) => i !== index));
      updateStages(nextStages, nextEnabled);
      if (selectedStageIndex >= nextStages.length) {
        setSelectedStageIndex(Math.max(0, nextStages.length - 1));
      }
    },
    [stages, stageEnabled, selectedStageIndex, updateStages],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = stageIds.indexOf(String(active.id));
      const newIndex = stageIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const nextStages = arrayMove(stages, oldIndex, newIndex);
      const nextEnabled = arrayMove(
        [...stageEnabled, ...Array<boolean>(Math.max(0, stages.length - stageEnabled.length)).fill(true)],
        oldIndex,
        newIndex,
      );
      setStageKeys((prev) => arrayMove(prev, oldIndex, newIndex));
      updateStages(nextStages, nextEnabled);

      // Track the selected stage through reorder
      if (selectedStageIndex === oldIndex) {
        setSelectedStageIndex(newIndex);
      } else if (
        selectedStageIndex >= Math.min(oldIndex, newIndex) &&
        selectedStageIndex <= Math.max(oldIndex, newIndex)
      ) {
        setSelectedStageIndex(
          oldIndex < newIndex
            ? selectedStageIndex - 1
            : selectedStageIndex + 1,
        );
      }
    },
    [stages, stageEnabled, stageIds, selectedStageIndex, updateStages],
  );

  const handleViewModeChange = useCallback(
    (value: string) => {
      onWorkbenchStateChange({
        aggregationViewMode: value as "visual" | "code",
      });
    },
    [onWorkbenchStateChange],
  );

  const handleCodeChange = useCallback(
    (nextStages: string[]) => {
      updateStages(
        nextStages,
        nextStages.map((_, i) => stageEnabled[i] ?? true),
      );
    },
    [stageEnabled, updateStages],
  );

  const runAggregation = useCallback(async () => {
    const enabledStages = stages.filter((_, i) => stageEnabled[i] !== false);
    const parsed = parseAggregationStages(enabledStages);
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
      setFullResult(
        normalizeMongoResult({
          operation: "aggregate",
          result: documents,
          collection,
        }),
      );
      setFullResultViewMode("data");
      setExecutionTime(Math.round(performance.now() - start));
    } catch (runError) {
      setFullResult(
        normalizeMongoResult({
          operation: "aggregate",
          error: runError,
          collection,
        }),
      );
      setFullResultViewMode("json");
      setExecutionTime(Math.round(performance.now() - start));
    }
  }, [collection, connectionId, database, stages, stageEnabled]);

  // -- Render ----------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b px-3 py-2">
        {QUICK_ADD_STAGES.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="outline"
            className="gap-1 text-xs"
            onClick={() => {
              const template = DEFAULT_STAGE_TEMPLATES[name];
              if (template) addStage(template);
            }}
          >
            <IconPlus className="h-3 w-3" />
            {name}
          </Button>
        ))}

        {MORE_STAGES.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="gap-1 text-xs" />}>
              <IconPlus className="h-3 w-3" />
              More...
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {MORE_STAGES.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => {
              const template = DEFAULT_STAGE_TEMPLATES[name];
              if (template) addStage(template);
            }}
                >
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        <Tabs value={viewMode} onValueChange={handleViewModeChange}>
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="visual" className="h-6 gap-1 px-2 text-xs">
              <IconLayoutList className="h-3.5 w-3.5" />
              Visual
            </TabsTrigger>
            <TabsTrigger value="code" className="h-6 gap-1 px-2 text-xs">
              <IconCode className="h-3.5 w-3.5" />
              Code
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1"
            onClick={() => void runAggregation()}
          >
            <IconPlayerPlay className="h-3.5 w-3.5" />
            Run
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={onOpenExplain}
          >
            <IconFilter className="h-3.5 w-3.5" />
            Explain
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Main content */}
      <div className="min-h-0 flex-1">
        {viewMode === "code" ? (
          <PipelineCodeView stages={stages} onChange={handleCodeChange} />
        ) : stages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Add a stage to begin building a pipeline.
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-2 gap-0">
            {/* Left: stage cards */}
            <div className="min-h-0 overflow-y-auto border-r p-3">
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={stageIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {stages.map((stageJson, index) => (
                      <StageCard
                        key={stageIds[index]}
                        id={stageIds[index] ?? `stage-${index}`}
                        index={index}
                        stageJson={stageJson}
                        enabled={stageEnabled[index] !== false}
                        selected={selectedStageIndex === index}
                        onJsonChange={(json) => {
                          handleStageJsonChange(index, json);
                        }}
                        onEnabledChange={(enabled) => {
                          handleStageEnabledChange(index, enabled);
                        }}
                        onDelete={() => { handleDeleteStage(index); }}
                        onSelect={() => { setSelectedStageIndex(index); }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            {/* Right: stage preview */}
            <div className="min-h-0 p-3">
              <StagePreview
                connectionId={connectionId}
                database={database}
                collection={collection}
                stages={stages}
                stageEnabled={stageEnabled}
                selectedStageIndex={selectedStageIndex}
                tabId={tabId}
              />
            </div>
          </div>
        )}
      </div>

      {/* Full pipeline results (shown after Run) */}
      {fullResult ? (
        <div className="flex-none border-t" style={{ height: "35%" }}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
              <span className="text-sm font-semibold">Full Pipeline Results</span>
              <Tabs
                value={fullResultViewMode}
                onValueChange={(value) => {
                  setFullResultViewMode(value as MongoResultViewMode);
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
            <div className="min-h-0 flex-1">
              <MongoResultViewer
                result={fullResult}
                viewMode={fullResultViewMode}
                connectionId={connectionId}
                database={database}
                gridId={`mongo-aggregation:${tabId}`}
                executionTime={executionTime}
                onClearResults={() => {
                  setFullResult(null);
                  setExecutionTime(null);
                }}
                className="h-full"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
