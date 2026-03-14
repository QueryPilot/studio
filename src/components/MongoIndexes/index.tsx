import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconSearch, IconPlus, IconRefresh } from "@tabler/icons-react";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type { MongoIndexInfo, MongoIndexOptions } from "@/adapters/types/mongodb";
import { useCrudStore } from "@/stores/crudStore";
import type {
  CrudCommand,
  CrudCommandTarget,
  DocumentIndexCreatePayload,
  DocumentIndexDropPayload,
} from "@/types/crud";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import { indexColumns } from "./columns";
import { IndexKeyCellRenderer } from "./IndexKeyCell";
import { IndexPropertiesCellRenderer } from "./IndexPropertiesCell";
import {
  buildMongoCommand,
  normalizeIndexOptionsForCrud,
} from "./commandFactory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyCell = CustomCell<Record<string, unknown>>;

interface MongoIndexesViewProps {
  target: CrudCommandTarget;
}

interface IndexRow {
  name: string;
  keys: Record<string, 1 | -1 | "text">;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds?: number;
  isTextIndex: boolean;
  language?: string;
  usage?: number;
  size?: string;
  isStaged: boolean;
  stagedCommandId?: string;
  isPendingDrop: boolean;
  dropCommandId?: string;
}

interface PendingKey {
  field: string;
  direction: "1" | "-1" | "text";
}

const EMPTY_COMMANDS: CrudCommand[] = [];

// Row theme overrides
const STAGED_CREATE_THEME = {
  bgCell: "rgba(34, 197, 94, 0.06)", // green tint
};

const STAGED_DROP_THEME = {
  bgCell: "rgba(239, 68, 68, 0.06)", // red tint
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MongoIndexesView = memo(function MongoIndexesView({
  target,
}: MongoIndexesViewProps) {
  const [indexes, setIndexes] = useState<MongoIndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [usageByName, setUsageByName] = useState<Record<string, number>>({});

  // Add-index popover state
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [newIndexName, setNewIndexName] = useState("");
  const [pendingKeys, setPendingKeys] = useState<PendingKey[]>([]);
  const [newKeyField, setNewKeyField] = useState("");
  const [newKeyDirection, setNewKeyDirection] = useState<"1" | "-1" | "text">("1");
  const [newUnique, setNewUnique] = useState(false);
  const [newSparse, setNewSparse] = useState(false);
  const [newTtl, setNewTtl] = useState("");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Review dialog state
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);

  // Key editor popover state
  const popoverAnchorRef = useRef<HTMLDivElement>(null);
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [keyEditorRowIndex, setKeyEditorRowIndex] = useState<number | null>(null);
  const [editKeyField, setEditKeyField] = useState("");
  const [editKeyDirection, setEditKeyDirection] = useState<"1" | "-1" | "text">("1");

  // Crud store
  const stageCommand = useCrudStore((state) => state.stageCommand);
  const unstageCommand = useCrudStore((state) => state.unstageCommand);
  const getTableKey = useCrudStore((state) => state.getTableKey);
  const discardChanges = useCrudStore((state) => state.discardChanges);
  const tableKey = getTableKey(target);
  const stagedCommands = useCrudStore(
    (state) => state.stagedCommands.get(tableKey) ?? EMPTY_COMMANDS,
  );

  // ---- Data loading ----

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adapter = new MongoDBAdapter(target.connectionId);
      const [nextIndexes, stats] = await Promise.all([
        adapter.listIndexes(target.table ?? "", target.database),
        adapter.getIndexUsageStats(target.table ?? "", target.database),
      ]);
      setIndexes(nextIndexes);
      setUsageByName(
        stats.reduce<Record<string, number>>((acc, stat) => {
          acc[stat.name] = stat.accesses.ops;
          return acc;
        }, {}),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [target.connectionId, target.database, target.table]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Build rows ----

  const rows = useMemo<IndexRow[]>(() => {
    const result: IndexRow[] = [];

    // Existing indexes
    for (const idx of indexes) {
      const dropCmd = stagedCommands.find(
        (cmd) =>
          cmd.type === "document.index.drop" &&
          (cmd.payload as DocumentIndexDropPayload).indexName === idx.name,
      );

      const hasTextKey = Object.values(idx.keys).includes("text");

      result.push({
        name: idx.name,
        keys: idx.keys,
        unique: idx.unique ?? false,
        sparse: idx.sparse ?? false,
        expireAfterSeconds: idx.expireAfterSeconds,
        isTextIndex: hasTextKey,
        language: idx.defaultLanguage,
        usage: usageByName[idx.name],
        isStaged: false,
        isPendingDrop: Boolean(dropCmd),
        dropCommandId: dropCmd?.id,
      });
    }

    // Staged create commands
    for (const cmd of stagedCommands) {
      if (cmd.type !== "document.index.create") continue;
      const payload = cmd.payload as DocumentIndexCreatePayload;
      const def = payload.definition;
      const hasTextKey = Object.values(def.keys).includes("text");
      const options = def.options ?? {};

      result.push({
        name: def.name,
        keys: def.keys,
        unique: options.unique === true,
        sparse: options.sparse === true,
        expireAfterSeconds:
          typeof options.expireAfterSeconds === "number"
            ? options.expireAfterSeconds
            : undefined,
        isTextIndex: hasTextKey,
        language:
          typeof options.defaultLanguage === "string"
            ? options.defaultLanguage
            : undefined,
        isStaged: true,
        stagedCommandId: cmd.id,
        isPendingDrop: false,
      });
    }

    return result;
  }, [indexes, stagedCommands, usageByName]);

  // Filter rows by search
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [rows, searchQuery]);

  // ---- Column sizing ----

  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: indexColumns,
      initialWidths: {},
      onChange: () => {
        // No persistence needed
      },
    });

  // ---- Custom renderers ----

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      IndexKeyCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexPropertiesCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  // ---- Cell content ----

  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row: IndexRow | undefined = filteredRows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      switch (column.field) {
        case "name": {
          const display = row.isStaged
            ? `${row.name} (staged)`
            : row.isPendingDrop
              ? `${row.name} (drop)`
              : row.name;
          return {
            kind: GridCellKind.Text,
            data: row.name,
            displayData: display,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        case "keys":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "index-key-cell" as const,
              keys: row.keys,
            },
            copyData: Object.entries(row.keys)
              .map(([k, v]) => `${k}:${String(v)}`)
              .join(", "),
            readonly: true,
            allowOverlay: false,
          } as const;

        case "properties":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "index-properties-cell" as const,
              unique: row.unique,
              sparse: row.sparse,
              expireAfterSeconds: row.expireAfterSeconds,
              isTextIndex: row.isTextIndex,
              language: row.language,
            },
            copyData: [
              row.unique ? "unique" : "",
              row.sparse ? "sparse" : "",
              typeof row.expireAfterSeconds === "number"
                ? `TTL ${String(row.expireAfterSeconds)}s`
                : "",
              row.isTextIndex ? "text" : "",
              row.language ?? "",
            ]
              .filter(Boolean)
              .join(", "),
            readonly: true,
            allowOverlay: false,
          } as const;

        case "usage": {
          const value =
            row.usage !== undefined ? String(row.usage) : "--";
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        case "size": {
          const value = row.size ?? "--";
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        case "actions": {
          if (row.isStaged) {
            return {
              kind: GridCellKind.Text,
              data: "Unstage",
              displayData: "Unstage",
              readonly: true,
              allowOverlay: false,
            } as const;
          }
          if (row.isPendingDrop) {
            return {
              kind: GridCellKind.Text,
              data: "Undo",
              displayData: "Undo",
              readonly: true,
              allowOverlay: false,
            } as const;
          }
          return {
            kind: GridCellKind.Text,
            data: row.name === "_id_" ? "" : "Drop",
            displayData: row.name === "_id_" ? "" : "Drop",
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        default:
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
            readonly: true,
            allowOverlay: false,
          } as const;
      }
    },
    [sizedColumns, filteredRows],
  );

  // ---- Row theme ----

  const getRowThemeOverride = useCallback(
    (row: number) => {
      const data = filteredRows[row];
      if (!data) return undefined;
      if (data.isStaged) return STAGED_CREATE_THEME;
      if (data.isPendingDrop) return STAGED_DROP_THEME;
      return undefined;
    },
    [filteredRows],
  );

  // ---- Cell click (actions + keys) ----

  const handleCellClicked = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row: IndexRow | undefined = filteredRows[rowIndex];
      if (!column || !row) return;

      // Actions column
      if (column.field === "actions") {
        if (row.isStaged && row.stagedCommandId) {
          unstageCommand(row.stagedCommandId);
          return;
        }
        if (row.isPendingDrop && row.dropCommandId) {
          unstageCommand(row.dropCommandId);
          return;
        }
        if (row.name !== "_id_") {
          setDeleteTarget(row.name);
          setDeleteDialogOpen(true);
        }
        return;
      }

      // Keys column click for staged rows -- open key editor
      if (column.field === "keys" && row.isStaged) {
        setKeyEditorRowIndex(rowIndex);
        setEditKeyField("");
        setEditKeyDirection("1");
        setKeyEditorOpen(true);
      }
    },
    [sizedColumns, filteredRows, unstageCommand],
  );

  // ---- Add key to staged index ----

  const handleAddKeyToStagedIndex = useCallback(() => {
    if (!editKeyField.trim() || keyEditorRowIndex === null) return;

    const row = filteredRows[keyEditorRowIndex];
    if (!row?.isStaged || !row.stagedCommandId) return;

    // Remove old staged command and re-stage with updated keys
    const cmd = stagedCommands.find((c) => c.id === row.stagedCommandId);
    if (!cmd || cmd.type !== "document.index.create") return;

    const payload = cmd.payload as DocumentIndexCreatePayload;
    const newKeys = { ...payload.definition.keys };
    newKeys[editKeyField.trim()] =
      editKeyDirection === "text"
        ? "text"
        : editKeyDirection === "-1"
          ? -1
          : 1;

    unstageCommand(row.stagedCommandId);

    const newCmd = buildMongoCommand<DocumentIndexCreatePayload>(
      "document.index.create",
      target,
      {
        definition: {
          ...payload.definition,
          keys: newKeys,
        },
      },
      `Create MongoDB index ${payload.definition.name}`,
      payload.definition.name,
    );
    stageCommand(newCmd);

    setEditKeyField("");
    setEditKeyDirection("1");
    setKeyEditorOpen(false);
    setKeyEditorRowIndex(null);
  }, [
    editKeyDirection,
    editKeyField,
    filteredRows,
    keyEditorRowIndex,
    stageCommand,
    stagedCommands,
    target,
    unstageCommand,
  ]);

  // ---- Stage create ----

  const handleStageCreate = useCallback(() => {
    const keys: Record<string, 1 | -1 | "text"> = {};
    for (const pk of pendingKeys) {
      if (pk.field.trim()) {
        keys[pk.field.trim()] =
          pk.direction === "text" ? "text" : pk.direction === "-1" ? -1 : 1;
      }
    }

    if (!newIndexName.trim() || Object.keys(keys).length === 0) {
      toast.error("Provide an index name and at least one key");
      return;
    }

    const options: MongoIndexOptions = {
      name: newIndexName.trim(),
      unique: newUnique,
      sparse: newSparse,
    };

    if (newTtl.trim()) {
      const ttl = Number(newTtl);
      if (!Number.isNaN(ttl) && ttl > 0) {
        options.expireAfterSeconds = ttl;
      }
    }

    const command = buildMongoCommand<DocumentIndexCreatePayload>(
      "document.index.create",
      target,
      {
        definition: {
          name: newIndexName.trim(),
          keys,
          options: normalizeIndexOptionsForCrud(options),
        },
      },
      `Create MongoDB index ${newIndexName.trim()}`,
      newIndexName.trim(),
    );
    stageCommand(command);

    // Reset form
    setNewIndexName("");
    setPendingKeys([]);
    setNewKeyField("");
    setNewKeyDirection("1");
    setNewUnique(false);
    setNewSparse(false);
    setNewTtl("");
    setAddPopoverOpen(false);
  }, [newIndexName, newSparse, newTtl, newUnique, pendingKeys, stageCommand, target]);

  // ---- Stage drop ----

  const handleConfirmDrop = useCallback(() => {
    if (!deleteTarget) return;
    const command = buildMongoCommand<DocumentIndexDropPayload>(
      "document.index.drop",
      target,
      { indexName: deleteTarget },
      `Drop MongoDB index ${deleteTarget}`,
      deleteTarget,
    );
    stageCommand(command);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  }, [deleteTarget, stageCommand, target]);

  // ---- Pending commands count ----

  const pendingCount = stagedCommands.filter(
    (cmd) =>
      cmd.type === "document.index.create" ||
      cmd.type === "document.index.drop",
  ).length;

  // ---- Add pending key ----

  const handleAddPendingKey = useCallback(() => {
    if (!newKeyField.trim()) return;
    setPendingKeys((prev) => [
      ...prev,
      { field: newKeyField.trim(), direction: newKeyDirection },
    ]);
    setNewKeyField("");
    setNewKeyDirection("1");
  }, [newKeyField, newKeyDirection]);

  // ---- Render ----

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
        <TableActionsToolbar
          onReviewChanges={() => {
            setReviewDialogOpen(true);
          }}
          onDiscard={() => {
            discardChanges(tableKey);
            toast.success("Changes discarded");
          }}
          pendingChangesCount={pendingCount}
          inline
        />

        <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
          <PopoverTrigger className="inline-flex items-center justify-center gap-1 rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground h-7 cursor-pointer">
            <IconPlus className="mr-1 h-3 w-3" />
            Add Index
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mongo-new-index-name" className="text-xs">
                  Index name
                </Label>
                <Input
                  id="mongo-new-index-name"
                  value={newIndexName}
                  onChange={(e) => {
                    setNewIndexName(e.target.value);
                  }}
                  className="h-8"
                  placeholder="idx_field_asc"
                />
              </div>

              {/* Keys list */}
              {pendingKeys.length > 0 ? (
                <div className="space-y-1">
                  <Label className="text-xs">Keys</Label>
                  <div className="flex flex-wrap gap-1">
                    {pendingKeys.map((pk, i) => (
                      <span
                        key={`${pk.field}-${String(i)}`}
                        className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 font-mono text-xs text-blue-600"
                      >
                        {pk.field}: {pk.direction}
                        <button
                          type="button"
                          className="ml-1 text-blue-400 hover:text-blue-600"
                          onClick={() => {
                            setPendingKeys((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            );
                          }}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Add key row */}
              <div className="flex gap-1.5">
                <Input
                  value={newKeyField}
                  onChange={(e) => {
                    setNewKeyField(e.target.value);
                  }}
                  placeholder="field name"
                  className="h-8 flex-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddPendingKey();
                    }
                  }}
                />
                <Select
                  value={newKeyDirection}
                  onValueChange={(v) => {
                    setNewKeyDirection(v as "1" | "-1" | "text");
                  }}
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Asc</SelectItem>
                    <SelectItem value="-1">Desc</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={handleAddPendingKey}
                >
                  +
                </Button>
              </div>

              {/* Options */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="mongo-new-index-unique"
                    checked={newUnique}
                    onCheckedChange={setNewUnique}
                  />
                  <Label htmlFor="mongo-new-index-unique" className="text-xs">
                    Unique
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="mongo-new-index-sparse"
                    checked={newSparse}
                    onCheckedChange={setNewSparse}
                  />
                  <Label htmlFor="mongo-new-index-sparse" className="text-xs">
                    Sparse
                  </Label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mongo-new-index-ttl" className="text-xs">
                  TTL (seconds)
                </Label>
                <Input
                  id="mongo-new-index-ttl"
                  type="number"
                  min={0}
                  value={newTtl}
                  onChange={(e) => {
                    setNewTtl(e.target.value);
                  }}
                  className="h-8"
                  placeholder="Optional"
                />
              </div>

              <Button size="sm" onClick={handleStageCreate}>
                Stage Create
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => void load()}
        >
          <IconRefresh className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <IconSearch className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            placeholder="Filter indexes..."
            className="h-7 w-40 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Grid or status */}
      <div className="relative min-h-0 flex-1" ref={popoverAnchorRef}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading indexes...
          </div>
        ) : error ? (
          <div className="m-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {searchQuery ? "No indexes match the filter." : "No indexes found."}
          </div>
        ) : (
          <DataGridBase
            columns={sizedColumns}
            rowCount={filteredRows.length}
            getCellContent={getCellContent}
            customRenderers={customRenderers}
            getRowThemeOverride={getRowThemeOverride}
            rowSelect="none"
            columnSelect="none"
            onColumnResize={handleColumnResize}
            onColumnResizeEnd={handleColumnResizeEnd}
            onCellClicked={handleCellClicked}
          />
        )}

        {/* Key editor popover -- positioned absolutely over the grid */}
        {keyEditorOpen && keyEditorRowIndex !== null ? (
          <div className="absolute left-4 top-4 z-50 rounded-md border bg-popover p-3 shadow-md">
            <div className="grid gap-2">
              <Label className="text-xs font-medium">Add key to index</Label>
              <div className="flex gap-1.5">
                <Input
                  value={editKeyField}
                  onChange={(e) => {
                    setEditKeyField(e.target.value);
                  }}
                  placeholder="field name"
                  className="h-8 flex-1 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddKeyToStagedIndex();
                    }
                    if (e.key === "Escape") {
                      setKeyEditorOpen(false);
                      setKeyEditorRowIndex(null);
                    }
                  }}
                />
                <Select
                  value={editKeyDirection}
                  onValueChange={(v) => {
                    setEditKeyDirection(v as "1" | "-1" | "text");
                  }}
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Asc</SelectItem>
                    <SelectItem value="-1">Desc</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleAddKeyToStagedIndex}
                >
                  Add
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => {
                  setKeyEditorOpen(false);
                  setKeyEditorRowIndex(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Delete confirmation */}
      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Drop Index"
        description="This will stage the index for deletion. Changes will be applied when you review and commit."
        entityName={deleteTarget ?? undefined}
        onConfirm={handleConfirmDrop}
        confirmLabel="Stage Drop"
      />

      {/* Global changes review dialog */}
      <GlobalChangesDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        connectionId={target.connectionId}
        database={target.database}
        table={target.table}
        onCommitSuccess={() => {
          void load();
        }}
      />
    </div>
  );
});

export default MongoIndexesView;
