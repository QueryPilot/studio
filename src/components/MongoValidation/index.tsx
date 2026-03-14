import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { JSON_EXTENSIONS } from "@/components/shared/codemirrorJsonExtensions";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type { MongoCollectionMetadata } from "@/adapters/types/mongodb";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand, CrudCommandTarget, DocumentValidationUpdatePayload } from "@/types/crud";
import type { MongoWorkbenchState } from "@/types/mongoWorkbench";
import { buildMongoCommand } from "@/components/MongoIndexes/commandFactory";

const EMPTY_COMMANDS: CrudCommand[] = [];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MongoValidationViewProps {
  target: CrudCommandTarget;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract `required` fields from a $jsonSchema validator for display. */
function parseRequiredFields(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const schema = (parsed.$jsonSchema ?? parsed) as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      return schema.required.filter(
        (f): f is string => typeof f === "string",
      );
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MongoValidationView = memo(function MongoValidationView({
  target,
  workbenchState,
  onWorkbenchStateChange,
}: MongoValidationViewProps) {
  const [metadata, setMetadata] = useState<MongoCollectionMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedFromMetadataRef = useRef(false);

  const { resolvedTheme } = useTheme();

  const stageCommand = useCrudStore((state) => state.stageCommand);
  const unstageCommand = useCrudStore((state) => state.unstageCommand);
  const getTableKey = useCrudStore((state) => state.getTableKey);
  const stagedCommands = useCrudStore(
    (state) => state.stagedCommands.get(getTableKey(target)) ?? EMPTY_COMMANDS,
  );

  // ---- Data loading -------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adapter = new MongoDBAdapter(target.connectionId);
      const nextMetadata = await adapter.getCollectionMetadata(
        target.table ?? "",
        target.database,
      );
      setMetadata(nextMetadata);

      if (!initializedFromMetadataRef.current && !workbenchState.validationJson) {
        onWorkbenchStateChange({
          validationJson: nextMetadata.validator
            ? JSON.stringify(nextMetadata.validator, null, 2)
            : "",
          validationLevel: nextMetadata.validationLevel ?? "strict",
          validationAction: nextMetadata.validationAction ?? "error",
        });
        initializedFromMetadataRef.current = true;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [
    onWorkbenchStateChange,
    target.connectionId,
    target.database,
    target.table,
    workbenchState.validationJson,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Staging ------------------------------------------------------------

  const stagedValidation = stagedCommands.find(
    (command) => command.type === "document.validation.update",
  );

  const stageValidation = useCallback(() => {
    const hasValidationInput = typeof workbenchState.validationJson === "string";
    const trimmedValidation = workbenchState.validationJson?.trim() ?? "";

    const command = buildMongoCommand<DocumentValidationUpdatePayload>(
      "document.validation.update",
      target,
      {
        validationJson: trimmedValidation || undefined,
        clearValidator: hasValidationInput && trimmedValidation.length === 0,
        validationLevel: workbenchState.validationLevel,
        validationAction: workbenchState.validationAction,
      },
      `Update MongoDB validation for ${target.table}`,
      target.table,
    );
    stageCommand(command);
  }, [
    stageCommand,
    target,
    workbenchState.validationAction,
    workbenchState.validationJson,
    workbenchState.validationLevel,
  ]);

  // ---- CodeMirror ---------------------------------------------------------

  const themeExtensions = useMemo(
    () => getThemeExtensions(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...themeExtensions],
    [themeExtensions],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      onWorkbenchStateChange({ validationJson: value });
    },
    [onWorkbenchStateChange],
  );

  // ---- Derived UI state ---------------------------------------------------

  const requiredFields = useMemo(
    () => parseRequiredFields(workbenchState.validationJson),
    [workbenchState.validationJson],
  );

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-none items-center gap-4 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Validation Rules</h3>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="mongo-validation-level" className="text-xs text-muted-foreground">
            Level
          </Label>
          <Select
            value={workbenchState.validationLevel ?? "strict"}
            onValueChange={(value) => {
              onWorkbenchStateChange({
                validationLevel: value as MongoWorkbenchState["validationLevel"],
              });
            }}
          >
            <SelectTrigger id="mongo-validation-level" size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">off</SelectItem>
              <SelectItem value="strict">strict</SelectItem>
              <SelectItem value="moderate">moderate</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="mongo-validation-action" className="text-xs text-muted-foreground">
            Action
          </Label>
          <Select
            value={workbenchState.validationAction ?? "error"}
            onValueChange={(value) => {
              onWorkbenchStateChange({
                validationAction: value as MongoWorkbenchState["validationAction"],
              });
            }}
          >
            <SelectTrigger id="mongo-validation-action" size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="error">error</SelectItem>
              <SelectItem value="warn">warn</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
          <Button size="sm" onClick={stageValidation}>
            Stage
          </Button>
          {stagedValidation ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                unstageCommand(stagedValidation.id);
              }}
            >
              Unstage
            </Button>
          ) : null}
        </div>
      </div>

      {/* Error / loading banner */}
      {loading ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Loading validation...</div>
      ) : null}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Main content: editor (left) + status panel (right) */}
      <div className="flex min-h-0 flex-1">
        {/* JSON editor */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <CodeMirror
            value={workbenchState.validationJson ?? ""}
            onChange={handleEditorChange}
            extensions={extensions}
            theme="none"
            height="100%"
            className="h-full"
            placeholder='{"$jsonSchema":{"bsonType":"object"}}'
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: false,
              defaultKeymap: false,
              searchKeymap: false,
              closeBrackets: true,
            }}
          />
        </div>

        {/* Status panel */}
        <div className="w-[280px] flex-none overflow-auto border-l bg-muted/10 p-3">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Server State
          </h4>

          <div className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Validator</span>
              <div className="mt-0.5 font-medium">
                {metadata === null
                  ? "..."
                  : metadata.validator
                    ? "Attached"
                    : "None"}
              </div>
            </div>

            <div>
              <span className="text-xs text-muted-foreground">Level</span>
              <div className="mt-0.5 font-medium">
                {metadata?.validationLevel ?? "n/a"}
              </div>
            </div>

            <div>
              <span className="text-xs text-muted-foreground">Action</span>
              <div className="mt-0.5 font-medium">
                {metadata?.validationAction ?? "n/a"}
              </div>
            </div>

            {requiredFields.length > 0 ? (
              <div>
                <span className="text-xs text-muted-foreground">Required fields</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {requiredFields.map((field) => (
                    <Badge key={field} variant="secondary" className="text-[11px]">
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
