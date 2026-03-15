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
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IconSearch, IconPlus, IconRefresh } from "@tabler/icons-react";
import { IconCopy, IconTrash, IconArrowBackUp } from "@tabler/icons-react";
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
import { writeClipboardText } from "@/lib/clipboard";
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
  isNewRow?: boolean;
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

const NEW_ROW_THEME = {
  bgCell: "rgba(34, 197, 94, 0.10)", // stronger green tint for inline new row
};

// ---------------------------------------------------------------------------
// Helper: format keys as MongoDB spec string
// ---------------------------------------------------------------------------

function formatKeySpec(keys: Record<string, 1 | -1 | "text">): string {
  const entries = Object.entries(keys)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : String(v)}`)
    .join(", ");
  return `{ ${entries} }`;
}

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

  // Inline new row state
  const [showNewRow, setShowNewRow] = useState(false);
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

  // Key editor popover state (for staged rows and inline new row)
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [keyEditorRowIndex, setKeyEditorRowIndex] = useState<number | null>(null);
  const [editKeyField, setEditKeyField] = useState("");
  const [editKeyDirection, setEditKeyDirection] = useState<"1" | "-1" | "text">("1");

  // Context menu state
  const hoveredRowRef = useRef<IndexRow | null>(null);
  const [contextMenuRow, setContextMenuRow] = useState<IndexRow | null>(null);

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

  // ---- Build grid rows (existing + staged + inline new row) ----

  const gridRows = useMemo<IndexRow[]>(() => {
    const base = rows;

    if (!showNewRow) return base;

    // Build the keys object from pendingKeys
    const keys: Record<string, 1 | -1 | "text"> = {};
    for (const pk of pendingKeys) {
      if (pk.field.trim()) {
        keys[pk.field.trim()] =
          pk.direction === "text" ? "text" : pk.direction === "-1" ? -1 : 1;
      }
    }

    const hasTextKey = Object.values(keys).some((v) => v === "text");

    const newRow: IndexRow = {
      name: newIndexName,
      keys,
      unique: newUnique,
      sparse: newSparse,
      expireAfterSeconds: newTtl.trim()
        ? (() => {
            const ttl = Number(newTtl);
            return !Number.isNaN(ttl) && ttl > 0 ? ttl : undefined;
          })()
        : undefined,
      isTextIndex: hasTextKey,
      isStaged: true,
      isPendingDrop: false,
      isNewRow: true,
    };

    return [...base, newRow];
  }, [rows, showNewRow, newIndexName, pendingKeys, newUnique, newSparse, newTtl]);

  // Filter rows by search
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return gridRows;
    const query = searchQuery.toLowerCase();
    return gridRows.filter(
      (row) => row.isNewRow || row.name.toLowerCase().includes(query),
    );
  }, [gridRows, searchQuery]);

  // ---- Explicit stage handler for inline new row ----

  const handleStageNewIndex = useCallback(() => {
    if (!newIndexName.trim() || pendingKeys.length === 0) return;

    const keys: Record<string, 1 | -1 | "text"> = {};
    for (const pk of pendingKeys) {
      if (pk.field.trim()) {
        keys[pk.field.trim()] =
          pk.direction === "text" ? "text" : pk.direction === "-1" ? -1 : 1;
      }
    }

    if (Object.keys(keys).length === 0) return;

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

    // Reset the inline row
    setShowNewRow(false);
    setNewIndexName("");
    setPendingKeys([]);
    setNewKeyField("");
    setNewKeyDirection("1");
    setNewUnique(false);
    setNewSparse(false);
    setNewTtl("");
  }, [
    newIndexName,
    pendingKeys,
    newUnique,
    newSparse,
    newTtl,
    stageCommand,
    target,
  ]);

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

      // New inline row -- show placeholder text for name
      if (row.isNewRow && column.field === "name") {
        const display = row.name || "(enter name)";
        return {
          kind: GridCellKind.Text,
          data: row.name,
          displayData: display,
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
          if (row.isNewRow) {
            return {
              kind: GridCellKind.Text,
              data: "Cancel",
              displayData: "Cancel",
              readonly: true,
              allowOverlay: false,
            } as const;
          }
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
      if (data.isNewRow) return NEW_ROW_THEME;
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
        if (row.isNewRow) {
          // Cancel the inline new row
          setShowNewRow(false);
          setNewIndexName("");
          setPendingKeys([]);
          setNewKeyField("");
          setNewKeyDirection("1");
          setNewUnique(false);
          setNewSparse(false);
          setNewTtl("");
          return;
        }
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

      // Keys column click for staged rows or new row -- open key editor
      if (column.field === "keys" && (row.isStaged || row.isNewRow)) {
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
    if (!row) return;

    // Handle new inline row
    if (row.isNewRow) {
      setPendingKeys((prev) => [
        ...prev,
        { field: editKeyField.trim(), direction: editKeyDirection },
      ]);
      setEditKeyField("");
      setEditKeyDirection("1");
      // Keep the editor open for more keys
      return;
    }

    if (!row.isStaged || !row.stagedCommandId) return;

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

  // ---- Handle add index (inline row) ----

  const handleAddIndex = useCallback(() => {
    if (showNewRow) return; // already showing
    setShowNewRow(true);
    setNewIndexName("");
    setPendingKeys([]);
    setNewKeyField("");
    setNewKeyDirection("1");
    setNewUnique(false);
    setNewSparse(false);
    setNewTtl("");
  }, [showNewRow]);

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

  // ---- Handle add pending key for inline new row ----

  const handleAddPendingKey = useCallback(() => {
    if (!newKeyField.trim()) return;
    setPendingKeys((prev) => [
      ...prev,
      { field: newKeyField.trim(), direction: newKeyDirection },
    ]);
    setNewKeyField("");
    setNewKeyDirection("1");
  }, [newKeyField, newKeyDirection]);

  // ---- Item hover for context menu ----

  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind === "cell") {
        hoveredRowRef.current = filteredRows[args.location[1]] ?? null;
      } else {
        hoveredRowRef.current = null;
      }
    },
    [filteredRows],
  );

  // ---- Context menu handlers ----

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setContextMenuRow(hoveredRowRef.current ?? null);
      } else {
        setContextMenuRow(null);
      }
    },
    [],
  );

  const handleCopyName = useCallback(() => {
    if (!contextMenuRow) return;
    void writeClipboardText(contextMenuRow.name).then(() => {
      toast.success("Copied index name");
    });
  }, [contextMenuRow]);

  const handleCopyKeySpec = useCallback(() => {
    if (!contextMenuRow) return;
    const spec = formatKeySpec(contextMenuRow.keys);
    void writeClipboardText(spec).then(() => {
      toast.success("Copied key spec");
    });
  }, [contextMenuRow]);

  const handleContextStageDrop = useCallback(() => {
    if (!contextMenuRow || contextMenuRow.name === "_id_") return;
    setDeleteTarget(contextMenuRow.name);
    setDeleteDialogOpen(true);
  }, [contextMenuRow]);

  const handleContextUnstage = useCallback(() => {
    if (!contextMenuRow) return;
    if (contextMenuRow.isStaged && contextMenuRow.stagedCommandId) {
      unstageCommand(contextMenuRow.stagedCommandId);
    }
    if (contextMenuRow.isPendingDrop && contextMenuRow.dropCommandId) {
      unstageCommand(contextMenuRow.dropCommandId);
    }
  }, [contextMenuRow, unstageCommand]);

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
            setShowNewRow(false);
            toast.success("Changes discarded");
          }}
          pendingChangesCount={pendingCount}
          inline
        />

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleAddIndex}
          disabled={showNewRow}
        >
          <IconPlus className="mr-1 h-3 w-3" />
          Add Index
        </Button>

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

      {/* Inline new row editor (rendered above the grid) */}
      {showNewRow ? (
        <div className="mx-2 mb-1.5 rounded-md border border-green-500/30 bg-green-500/5 p-2">
          <div className="flex items-center gap-2">
            {/* Name input */}
            <Input
              value={newIndexName}
              onChange={(e) => {
                setNewIndexName(e.target.value);
              }}
              placeholder="Index name"
              className="h-7 w-40 text-xs"
              autoFocus
            />

            {/* Pending keys display */}
            {pendingKeys.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {pendingKeys.map((pk, i) => (
                  <span
                    key={`${pk.field}-${String(i)}`}
                    className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-600"
                  >
                    {pk.field}: {pk.direction}
                    <button
                      type="button"
                      className="ml-0.5 text-blue-400 hover:text-blue-600"
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
            ) : null}

            {/* Add key inline */}
            <Input
              value={newKeyField}
              onChange={(e) => {
                setNewKeyField(e.target.value);
              }}
              placeholder="field"
              className="h-7 w-24 text-xs"
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
              <SelectTrigger className="h-7 w-16 text-xs">
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
              className="h-7 px-2 text-xs"
              onClick={handleAddPendingKey}
            >
              <IconPlus className="h-3 w-3" />
            </Button>

            {/* Properties toggles */}
            <div className="flex items-center gap-1.5 ml-1">
              <Button
                size="sm"
                variant={newUnique ? "default" : "outline"}
                className="h-6 px-2 text-[10px]"
                onClick={() => {
                  setNewUnique((v) => !v);
                }}
              >
                unique
              </Button>
              <Button
                size="sm"
                variant={newSparse ? "default" : "outline"}
                className="h-6 px-2 text-[10px]"
                onClick={() => {
                  setNewSparse((v) => !v);
                }}
              >
                sparse
              </Button>
              <Input
                value={newTtl}
                onChange={(e) => {
                  setNewTtl(e.target.value);
                }}
                placeholder="TTL"
                type="number"
                min={0}
                className="h-7 w-16 text-xs"
              />
            </div>

            <div className="flex-1" />

            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setShowNewRow(false);
                setNewIndexName("");
                setPendingKeys([]);
                setNewKeyField("");
                setNewKeyDirection("1");
                setNewUnique(false);
                setNewSparse(false);
                setNewTtl("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!newIndexName.trim() || pendingKeys.length === 0}
              onClick={handleStageNewIndex}
            >
              Stage
            </Button>
          </div>
        </div>
      ) : null}

      {/* Grid or status */}
      <div className="relative min-h-0 flex-1">
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
          <ContextMenu onOpenChange={handleContextMenuOpenChange}>
            <ContextMenuTrigger className="h-full w-full block">
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
                onItemHovered={handleItemHovered}
              />
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56 text-xs p-1">
              {contextMenuRow && !contextMenuRow.isNewRow ? (
                <>
                  {/* Copy index name */}
                  <ContextMenuItem onClick={handleCopyName}>
                    <IconCopy className="text-foreground" />
                    <span className="flex-1">Copy Index Name</span>
                  </ContextMenuItem>

                  {/* Copy key spec */}
                  <ContextMenuItem onClick={handleCopyKeySpec}>
                    <IconCopy className="text-foreground" />
                    <span className="flex-1">Copy Key Spec</span>
                  </ContextMenuItem>

                  <ContextMenuSeparator />

                  {/* Stage Drop (for existing non-_id_ indexes) */}
                  {!contextMenuRow.isStaged &&
                    !contextMenuRow.isPendingDrop &&
                    contextMenuRow.name !== "_id_" ? (
                    <ContextMenuItem
                      variant="destructive"
                      onClick={handleContextStageDrop}
                    >
                      <IconTrash />
                      <span className="flex-1">Stage Drop</span>
                    </ContextMenuItem>
                  ) : null}

                  {/* Unstage (for staged or pending drop rows) */}
                  {contextMenuRow.isStaged || contextMenuRow.isPendingDrop ? (
                    <ContextMenuItem onClick={handleContextUnstage}>
                      <IconArrowBackUp className="text-foreground" />
                      <span className="flex-1">Unstage</span>
                    </ContextMenuItem>
                  ) : null}
                </>
              ) : (
                <ContextMenuItem disabled>
                  <span className="text-muted-foreground">No actions</span>
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
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

