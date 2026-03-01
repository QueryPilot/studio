import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/databaseService";
import { eventBus } from "@/services/eventBus";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import useWorkbenchStore from "@/stores/workbenchStore";

import { buildCreateCommand } from "./buildCommand";
import { CommandPreview } from "./CommandPreview";
import { collectionDesignerReducer, INITIAL_STATE } from "./reducer";
import { CappedSection } from "./sections/CappedSection";
import { ClusteredSection } from "./sections/ClusteredSection";
import { CollationSection } from "./sections/CollationSection";
import { SeedSection } from "./sections/SeedSection";
import { TimeSeriesSection } from "./sections/TimeSeriesSection";
import { ValidationSection } from "./sections/ValidationSection";

export interface CollectionDesignerProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  className?: string;
  onSave?: (collectionName: string) => void;
  onCancel?: () => void;
}

const parseObjectJson = (
  label: string,
  rawValue: string,
): Record<string, unknown> => {
  const trimmed = rawValue.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
};

const validateCollectionName = (value: string): string | null => {
  if (!value) return "Collection name is required";
  if (value.startsWith("system.")) {
    return "Collection name cannot start with system.";
  }
  if (value.includes("\0")) {
    return "Collection name cannot contain null characters";
  }
  return null;
};

export const CollectionDesigner: React.FC<CollectionDesignerProps> = ({
  panelId,
  tabId,
  connectionId,
  database,
  className,
  onSave,
  onCancel,
}) => {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(collectionDesignerReducer, INITIAL_STATE);

  const normalizedName = useMemo(
    () => state.collectionName.trim(),
    [state.collectionName],
  );

  const saveDisabled = state.isSaving || !normalizedName || !database;

  // Parse MongoDB server version for feature gating (e.g. "6.0.5" → [6, 0])
  const [serverMajor, serverMinor] = useMemo(() => {
    const conn = databaseService.getActiveConnection(connectionId);
    if (!conn?.server_version) return [0, 0];
    const match = conn.server_version.match(/^(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : [0, 0];
  }, [connectionId]);

  const supportsTimeSeries = serverMajor > 5 || (serverMajor === 5 && serverMinor >= 0);
  const supportsClustered = serverMajor > 5 || (serverMajor === 5 && serverMinor >= 3);

  const handleSave = useCallback(async () => {
    // 1. Validate collection name
    const nameError = validateCollectionName(normalizedName);
    if (nameError) {
      toast.error(nameError);
      return;
    }

    if (!database) {
      toast.error("No database selected");
      return;
    }

    // 2. Validate capped fields
    if (state.cappedEnabled) {
      const size = Number.parseInt(state.cappedSize, 10);
      if (Number.isNaN(size) || size <= 0) {
        toast.error("Capped size must be a positive integer");
        return;
      }
      if (state.cappedMax.trim()) {
        const max = Number.parseInt(state.cappedMax, 10);
        if (Number.isNaN(max) || max <= 0) {
          toast.error("Max documents must be a positive integer");
          return;
        }
      }
    }

    // 3. Validate time series
    if (state.timeSeriesEnabled) {
      if (!state.timeField.trim()) {
        toast.error("Time field is required for Time Series collections");
        return;
      }
      if (state.expireAfterSeconds.trim()) {
        const expire = Number.parseInt(state.expireAfterSeconds, 10);
        if (Number.isNaN(expire) || expire <= 0) {
          toast.error("Expire after seconds must be a positive integer");
          return;
        }
      }
    }

    // 3b. Validate clustered expireAfterSeconds
    if (state.clusteredEnabled && state.clusteredExpireAfterSeconds.trim()) {
      const expire = Number.parseInt(state.clusteredExpireAfterSeconds, 10);
      if (Number.isNaN(expire) || expire <= 0) {
        toast.error("Expire after seconds must be a positive integer");
        return;
      }
    }

    // 4. Validate validator JSON
    if (state.validationEnabled) {
      try {
        parseObjectJson("Validator", state.validatorJson);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Invalid validator JSON");
        return;
      }
    }

    // 5. Validate seed JSON
    if (state.seedEnabled) {
      try {
        parseObjectJson("Seed document", state.seedJson);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Invalid seed document JSON",
        );
        return;
      }
    }

    try {
      dispatch({ type: "SET_SAVING", value: true });
      const adapter = new MongoDBAdapter(connectionId);

      // 6. Check collection doesn't already exist
      const existingCollections = await adapter.listCollections(database);
      const alreadyExists = existingCollections.some(
        (item) => item.name === normalizedName,
      );
      if (alreadyExists) {
        toast.error("Collection already exists");
        return;
      }

      // 7. Build and execute command
      const createCommand = buildCreateCommand(state);
      await adapter.runCommand(createCommand, database);

      // 8. Optional seed
      if (state.seedEnabled) {
        const seedDocument = parseObjectJson("Seed document", state.seedJson);
        await adapter.insertDocument(normalizedName, seedDocument, database);
      }

      // 9. Invalidate cache, toast, callback
      await queryClient.invalidateQueries({
        queryKey: ["mongo-collections", connectionId, database],
      });

      toast.success("Collection created", {
        description: normalizedName,
      });
      onSave?.(normalizedName);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create collection";
      toast.error("Create collection failed", {
        description: message,
      });
    } finally {
      dispatch({ type: "SET_SAVING", value: false });
    }
  }, [
    connectionId,
    database,
    normalizedName,
    onSave,
    queryClient,
    state,
  ]);

  useEffect(() => {
    const handleSaveShortcut = (payload: {
      panelId?: string;
      tabId?: string;
    }) => {
      if (payload.panelId && payload.panelId !== panelId) return;
      if (payload.tabId && payload.tabId !== tabId) return;
      if (usePanelFocusStore.getState().focusedPanelId !== panelId) return;

      const panel = useWorkbenchStore.getState().panelContents.get(panelId);
      if (!panel || panel.activeTabId !== tabId) return;
      void handleSave();
    };

    eventBus.on("collection-designer:save", handleSaveShortcut);
    return () => {
      eventBus.off("collection-designer:save", handleSaveShortcut);
    };
  }, [handleSave, panelId, tabId]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Collection Designer
              </h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                Create a new collection in
                <code className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {database || "..."}
                </code>
              </p>
            </div>
            <span className="mt-1 select-none rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
              draft
            </span>
          </div>

          {/* Collection name — full width */}
          <div className="mt-5 space-y-1.5">
            <Label
              htmlFor="collection-name"
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              Collection name
            </Label>
            <Input
              id="collection-name"
              value={state.collectionName}
              onChange={(e) => {
                dispatch({
                  type: "SET_FIELD",
                  field: "collectionName",
                  value: e.target.value,
                });
              }}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  const input = e.currentTarget;
                  const start = input.selectionStart ?? input.value.length;
                  const end = input.selectionEnd ?? start;
                  const next =
                    input.value.slice(0, start) + "_" + input.value.slice(end);
                  dispatch({
                    type: "SET_FIELD",
                    field: "collectionName",
                    value: next,
                  });
                  requestAnimationFrame(() => {
                    input.setSelectionRange(start + 1, start + 1);
                  });
                }
              }}
              placeholder="e.g. users"
              className="h-9 font-mono"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground/60">
              Cannot start with <code className="text-[10px]">system.</code>
            </p>
          </div>

          {/* Two-column: Configuration + Preview */}
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* Configuration modules */}
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
                  Configuration
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <div className="space-y-3">
                <SeedSection state={state} dispatch={dispatch} />
                <CappedSection state={state} dispatch={dispatch} />
                <TimeSeriesSection state={state} dispatch={dispatch} supported={supportsTimeSeries} />
                <ClusteredSection state={state} dispatch={dispatch} supported={supportsClustered} />
                <CollationSection state={state} dispatch={dispatch} />
                <ValidationSection state={state} dispatch={dispatch} />
              </div>
            </div>

            {/* Preview */}
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
                  Preview
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              <CommandPreview state={state} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-muted-foreground/60">
            <Kbd>⌘S</Kbd>
            <span className="ml-1 text-[11px]">to save</span>
          </div>
          <div className="flex items-center gap-2">
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={state.isSaving}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saveDisabled}
            >
              {state.isSaving ? "Creating\u2026" : "Create Collection"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionDesigner;
