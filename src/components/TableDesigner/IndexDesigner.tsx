import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { IconSparkles } from "@tabler/icons-react";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import type { GridColumnV2 } from "@/components/DataGrid/types";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  createIndexCreateCommand,
  generateCommandId,
} from "@/components/TableIndexes/commandFactory";
import { getDialectFromDbType } from "@/components/TableIndexes/utils";
import { useSupportedIndexTypes } from "@/hooks/useSupportedIndexTypes";
import { generateIndexName, buildDesignerIndexRows } from "./utils";
import { toast } from "sonner";
import IndexNameCellRenderer from "@/components/TableIndexes/IndexNameCellRenderer";
import { IndexColumnsCellRenderer } from "@/components/TableIndexes/IndexColumnsCellRenderer";
import { IndexTypeCellRenderer } from "@/components/TableIndexes/IndexTypeCellRenderer";
import { IndexUniqueCellRenderer } from "@/components/TableIndexes/IndexUniqueCellRenderer";
import { ConditionCellRenderer } from "@/components/TableIndexes/ConditionCellRenderer";
import { ActionsCellRenderer } from "@/components/TableStructure/ActionsCellRenderer";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import type { IndexGridRow } from "@/components/TableIndexes/types";
import type {
  CrudCommand,
  CrudCommandTarget,
  IndexCreatePayload,
} from "@/types/crud";
import { DbType } from "@/types/connection";
import { DesignerIndexContextMenu } from "./DesignerIndexContextMenu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexDesignerProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  schema?: string;
  availableColumns: string[];
  tableName: string;
  foreignKeyColumns: string[];
  designerTag: string;
}

type AnyCell = CustomCell<Record<string, unknown>>;

/** Local draft for an index that hasn't been staged yet (incomplete). */
interface IndexDraft {
  tempId: string;
  name: string;
  columns: string[];
  unique: boolean;
  using: string;
  where?: string;
  /** Whether the name was auto-generated (safe to overwrite on column changes). */
  _autoName: boolean;
}

// ---------------------------------------------------------------------------
// Grid column definitions (no "Usage Stats" column for new-table context)
// ---------------------------------------------------------------------------

const designerIndexColumns: GridColumnV2[] = [
  {
    id: "row_number",
    field: "row_number",
    title: "#",
    name: "#",
    width: 48,
    minWidth: 48,
    maxWidth: 80,
  },
  {
    id: "name",
    field: "name",
    title: "Name",
    name: "Name",
    width: 200,
    minWidth: 120,
    maxWidth: 400,
  },
  {
    id: "columns",
    field: "columns",
    title: "Columns",
    name: "Columns",
    width: 260,
    minWidth: 160,
    maxWidth: 500,
  },
  {
    id: "index_type",
    field: "index_type",
    title: "Type",
    name: "Type",
    width: 100,
    minWidth: 80,
    maxWidth: 160,
  },
  {
    id: "unique",
    field: "unique",
    title: "Unique",
    name: "Unique",
    width: 80,
    minWidth: 72,
    maxWidth: 120,
  },
  {
    id: "condition",
    field: "condition",
    title: "Condition",
    name: "Condition",
    width: 280,
    minWidth: 160,
  },
  {
    id: "actions",
    field: "actions",
    title: "",
    name: "",
    width: 48,
    minWidth: 48,
    maxWidth: 48,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const IndexDesigner = memo(function IndexDesigner({
  panelId,
  tabId,
  connectionId,
  database,
  schema,
  availableColumns,
  tableName,
  foreignKeyColumns,
  designerTag,
}: IndexDesignerProps) {
  // ---- Stores ----------------------------------------------------------
  const stagedCommands = useCrudStore((s) => s.stagedCommands);
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const stageBatchWithSingleHistoryEntry = useCrudStore(
    (s) => s.stageBatchWithSingleHistoryEntry,
  );
  const unstageCommands = useCrudStore((s) => s.unstageCommands);

  const connection = useConnectionStore((s) => s.getConnection(connectionId));
  const dbType = connection?.profile.db_type ?? DbType.PostgreSQL;
  const dialect = getDialectFromDbType(dbType);

  const { indexTypes, defaultType: defaultIndexType } = useSupportedIndexTypes({
    connectionId,
    dbType,
  });

  const identifierLimit = dbType === DbType.SQLServer ? 128
    : dbType === DbType.SQLite ? 1024 : 63;

  // ---- Tag prefix for index commands -----------------------------------
  const idxTagPrefix = useMemo(
    () => `table-designer-idx:${panelId}:${tabId}:`,
    [panelId, tabId],
  );

  // ---- Filter staged commands to those belonging to this designer ------
  const designerIndexCommands = useMemo(() => {
    const commands: CrudCommand[] = [];
    stagedCommands.forEach((items) => {
      items.forEach((command) => {
        if (
          command.type === "index.create" &&
          command.metadata.tags?.includes(designerTag)
        ) {
          commands.push(command);
        }
      });
    });
    return commands;
  }, [designerTag, stagedCommands]);

  // ---- Local drafts for incomplete indexes (not yet staged) -----------
  const [localDrafts, setLocalDrafts] = useState<IndexDraft[]>([]);

  // ---- Build grid rows from staged index commands ----------------------
  const stagedGridRows = useMemo(
    () => buildDesignerIndexRows(designerIndexCommands),
    [designerIndexCommands],
  );

  // Build grid rows from local drafts
  const draftGridRows = useMemo(
    (): IndexGridRow[] =>
      localDrafts.map((draft, i) => ({
        row_number: stagedGridRows.length + i + 1,
        name: draft.name,
        name_meta: { primary: false, unique: draft.unique },
        columns: draft.columns.join(", "),
        columns_array: draft.columns,
        index_type: draft.using,
        unique: draft.unique ? "YES" : "NO",
        statistics: "",
        condition: draft.where ?? "",
        _tempId: draft.tempId,
        _isPending: true,
      })),
    [localDrafts, stagedGridRows.length],
  );

  // Combine staged + draft rows for the grid
  const gridRows = useMemo(
    () => [...stagedGridRows, ...draftGridRows],
    [stagedGridRows, draftGridRows],
  );

  // Quick lookup for draft tempIds
  const draftTempIds = useMemo(
    () => new Set(localDrafts.map((d) => d.tempId)),
    [localDrafts],
  );

  // ---- Columns that are valid for index column selection ---------------
  const validColumns = useMemo(
    () => availableColumns.filter((c) => c.trim().length > 0),
    [availableColumns],
  );

  // ---- FK suggestion: find FK columns not yet covered by an index ------
  const uncoveredFkColumns = useMemo(() => {
    const coveredColumns = new Set<string>();
    gridRows.forEach((row) => {
      row.columns_array.forEach((col) => coveredColumns.add(col));
    });
    return foreignKeyColumns.filter((col) => !coveredColumns.has(col));
  }, [foreignKeyColumns, gridRows]);

  // ---- Column sizing ---------------------------------------------------
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: designerIndexColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // ---- Custom cell renderers -------------------------------------------
  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      IndexNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexColumnsCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexTypeCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexUniqueCellRenderer as unknown as CustomRenderer<AnyCell>,
      ConditionCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      ActionsCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  // ---- Handlers --------------------------------------------------------

  const handleAddIndex = useCallback(() => {
    const tempId = generateCommandId();
    setLocalDrafts((prev) => [
      ...prev,
      {
        tempId,
        name: "",
        columns: [],
        unique: false,
        using: defaultIndexType,
        _autoName: true,
      },
    ]);
  }, [defaultIndexType]);

  /** Promote a local draft to a staged CRUD command. */
  const stageDraft = useCallback(
    (draft: IndexDraft) => {
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table: tableName || "__new_table",
      };

      const command = createIndexCreateCommand(
        target,
        {
          name: draft.name,
          columns: draft.columns,
          unique: draft.unique,
          using: draft.using,
          where: draft.where,
        },
        draft.tempId,
      );

      const taggedCommand = {
        ...command,
        metadata: {
          ...command.metadata,
          tags: [designerTag, `${idxTagPrefix}${draft.tempId}`],
        },
      };

      setLocalDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId));
      stageBatchWithSingleHistoryEntry([taggedCommand]);
    },
    [
      connectionId,
      database,
      schema,
      tableName,
      designerTag,
      idxTagPrefix,
      stageBatchWithSingleHistoryEntry,
    ],
  );

  const handleAddFkIndexes = useCallback(() => {
    if (uncoveredFkColumns.length === 0) return;

    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table: tableName || "__new_table",
    };

    const commands: CrudCommand[] = uncoveredFkColumns.map((fkCol) => {
      const tempId = generateCommandId();
      const name = generateIndexName(tableName, [fkCol], identifierLimit);
      const command = createIndexCreateCommand(
        target,
        {
          name,
          columns: [fkCol],
          unique: false,
          using: defaultIndexType,
        },
        tempId,
      );
      return {
        ...command,
        metadata: {
          ...command.metadata,
          tags: [designerTag, `${idxTagPrefix}${tempId}`],
        },
      };
    });

    stageBatchWithSingleHistoryEntry(commands);
    toast.success(`Added ${commands.length} index${commands.length > 1 ? "es" : ""} for foreign key columns`);
  }, [
    connectionId,
    database,
    schema,
    tableName,
    defaultIndexType,
    designerTag,
    idxTagPrefix,
    identifierLimit,
    uncoveredFkColumns,
    stageBatchWithSingleHistoryEntry,
  ]);

  const handleDeleteIndex = useCallback(
    (row: IndexGridRow) => {
      // Check if this is a local draft
      if (row._tempId && draftTempIds.has(row._tempId)) {
        setLocalDrafts((prev) =>
          prev.filter((d) => d.tempId !== row._tempId),
        );
        return;
      }

      // Otherwise, unstage the command
      const command = designerIndexCommands.find(
        (cmd) =>
          (cmd.payload as IndexCreatePayload).tempId === row._tempId,
      );
      if (command) {
        unstageCommands([command.id]);
      }
    },
    [designerIndexCommands, draftTempIds, unstageCommands],
  );

  // Extract value from custom cell data
  const extractCellValue = (newValue: EditableGridCell): unknown => {
    if ("data" in newValue) {
      const data = newValue.data;
      if (typeof data === "object" && data !== null) {
        if (
          "name" in data &&
          (data as { kind?: string }).kind === "editable-index-name-cell"
        ) {
          return (data as { name: string }).name;
        }
        if (
          "columns" in data &&
          (data as { kind?: string }).kind === "index-columns-cell"
        ) {
          return (data as { columns: string[] }).columns;
        }
        if ("value" in data) {
          return (data as { value: unknown }).value;
        }
      }
      return data;
    }
    return null;
  };

  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      const value = extractCellValue(newValue);
      const isDraft = row._tempId != null && draftTempIds.has(row._tempId);

      // ---- Editing a local draft ----
      if (isDraft) {
        setLocalDrafts((prev) =>
          prev.map((draft) => {
            if (draft.tempId !== row._tempId) return draft;

            const updated = { ...draft };

            switch (column.field) {
              case "name":
                updated.name = typeof value === "string" ? value : "";
                updated._autoName = false;
                break;
              case "columns": {
                updated.columns = Array.isArray(value) ? value : [];
                if (!updated.name || updated._autoName) {
                  updated.name = generateIndexName(
                    tableName,
                    updated.columns,
                    identifierLimit,
                  );
                  updated._autoName = true;
                }
                break;
              }
              case "index_type":
                updated.using =
                  typeof value === "string" ? value : defaultIndexType;
                break;
              case "unique":
                updated.unique = value === "YES";
                break;
              case "condition": {
                const condValue = typeof value === "string" ? value : "";
                updated.where = condValue || undefined;
                break;
              }
              default:
                return draft;
            }

            return updated;
          }),
        );

        // If columns were just set, promote draft to staged
        if (column.field === "columns") {
          const cols = Array.isArray(value) ? value : [];
          if (cols.length > 0) {
            const draft = localDrafts.find((d) => d.tempId === row._tempId);
            if (draft) {
              const updated = { ...draft, columns: cols };
              if (!updated.name || updated._autoName) {
                updated.name = generateIndexName(tableName, cols, identifierLimit);
                updated._autoName = true;
              }
              stageDraft(updated);
            }
          }
        }
        return;
      }

      // ---- Editing a staged command ----
      const command = designerIndexCommands.find(
        (cmd) =>
          (cmd.payload as IndexCreatePayload).tempId === row._tempId,
      );
      if (!command) return;

      const payload = command.payload as IndexCreatePayload;
      const updatedDefinition = { ...payload.definition };

      const MANUAL_NAME_TAG = "__manual_name__";
      const isAutoName = !command.metadata.tags?.includes(MANUAL_NAME_TAG);

      let markManualName: boolean | undefined;

      switch (column.field) {
        case "name":
          updatedDefinition.name =
            typeof value === "string" ? value : "";
          markManualName = true;
          break;

        case "columns": {
          updatedDefinition.columns = Array.isArray(value) ? value : [];
          if (
            !updatedDefinition.name ||
            isAutoName
          ) {
            updatedDefinition.name = generateIndexName(
              tableName,
              updatedDefinition.columns,
              identifierLimit,
            );
            markManualName = false;
          }
          break;
        }

        case "index_type":
          updatedDefinition.using =
            typeof value === "string" ? value : defaultIndexType;
          break;

        case "unique":
          updatedDefinition.unique = value === "YES";
          break;

        case "condition": {
          const condValue = typeof value === "string" ? value : "";
          updatedDefinition.where = condValue || undefined;
          break;
        }

        default:
          return;
      }

      const updatedCmd = {
        ...command,
        payload: {
          ...payload,
          definition: updatedDefinition,
        },
        metadata: {
          ...command.metadata,
          description: `Create index ${updatedDefinition.name || "(unnamed)"}`,
          ...(markManualName !== undefined
            ? {
                tags: markManualName
                  ? [...(command.metadata.tags ?? []).filter((t) => t !== MANUAL_NAME_TAG), MANUAL_NAME_TAG]
                  : (command.metadata.tags ?? []).filter((t) => t !== MANUAL_NAME_TAG),
              }
            : {}),
        },
      };

      stageCommand(updatedCmd);
    },
    [
      sizedColumns,
      gridRows,
      draftTempIds,
      localDrafts,
      designerIndexCommands,
      tableName,
      defaultIndexType,
      identifierLimit,
      stageCommand,
      stageDraft,
    ],
  );

  const handleCellClick = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      if (column.field === "actions") {
        handleDeleteIndex(row);
      }
    },
    [sizedColumns, gridRows, handleDeleteIndex],
  );

  // ---- Context menu -----------------------------------------------------
  const contextMenuRowRef = useRef<IndexGridRow | null>(null);

  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind === "cell") {
        contextMenuRowRef.current = gridRows[args.location[1]] ?? null;
      } else {
        contextMenuRowRef.current = null;
      }
    },
    [gridRows],
  );

  const handleContextToggleUnique = useCallback(
    (row: IndexGridRow) => {
      // Handle local draft
      if (row._tempId != null && draftTempIds.has(row._tempId)) {
        setLocalDrafts((prev) =>
          prev.map((d) =>
            d.tempId === row._tempId ? { ...d, unique: !d.unique } : d,
          ),
        );
        return;
      }

      const command = designerIndexCommands.find(
        (cmd) =>
          (cmd.payload as IndexCreatePayload).tempId === row._tempId,
      );
      if (!command) return;

      const payload = command.payload as IndexCreatePayload;
      const updatedCmd = {
        ...command,
        payload: {
          ...payload,
          definition: {
            ...payload.definition,
            unique: !payload.definition.unique,
          },
        },
      };
      stageCommand(updatedCmd);
    },
    [designerIndexCommands, draftTempIds, stageCommand],
  );

  // ---- getCellContent --------------------------------------------------
  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      const isUnique = row.name_meta.unique;

      // All rows in designer are new (green background)
      const rowTheme = {
        bgCell: "rgba(34, 197, 94, 0.06)",
        bgCellMedium: "rgba(34, 197, 94, 0.08)",
        accentColor: "rgba(34, 197, 94, 0.4)",
        accentLight: "rgba(34, 197, 94, 0.15)",
      };

      if (column.field === "row_number") {
        return {
          kind: GridCellKind.Number,
          data: row.row_number,
          displayData: String(row.row_number),
          readonly: true,
          allowOverlay: false,
          themeOverride: {
            ...rowTheme,
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      if (column.field === "name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "editable-index-name-cell",
            name: row.name,
            isPrimary: false,
            isUnique,
            isLocked: false,
          },
          copyData: row.name,
          readonly: false,
          allowOverlay: true,
          themeOverride: rowTheme,
        } as const;
      }

      if (column.field === "columns") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-columns-cell",
            columns: row.columns_array,
            availableColumns: validColumns,
            requiresRecreate: false,
            isLocked: false,
          },
          copyData: row.columns_array.join(", "),
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      if (column.field === "index_type") {
        const typeValue = row.index_type || defaultIndexType;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-type-cell",
            value: typeValue,
            options: indexTypes,
            requiresRecreate: false,
            isLocked: false,
          },
          copyData: typeValue,
          readonly: false,
          allowOverlay: true,
          themeOverride: rowTheme,
        } as const;
      }

      if (column.field === "unique") {
        const uniqueValue: "YES" | "NO" = row.unique === "YES" ? "YES" : "NO";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-unique-cell",
            value: uniqueValue,
            requiresRecreate: false,
            isLocked: false,
          },
          copyData: uniqueValue,
          readonly: false,
          allowOverlay: true,
          themeOverride: rowTheme,
        } as const;
      }

      if (column.field === "condition") {
        const conditionValue = row.condition || "";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-condition-cell",
            value: conditionValue,
            requiresRecreate: false,
            isLocked: false,
            dialect: dialect || "postgresql",
          },
          copyData: conditionValue,
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
            textDark: conditionValue ? "#3b82f6" : undefined,
          },
        } as const;
      }

      if (column.field === "actions") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "actions-cell",
            isPendingDelete: false,
          },
          copyData: "",
          readonly: true,
          allowOverlay: false,
          themeOverride: rowTheme,
        } as const;
      }

      // Default fallback
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "",
        readonly: true,
        allowOverlay: false,
        themeOverride: rowTheme,
      } as const;
    },
    [
      sizedColumns,
      gridRows,
      validColumns,
      indexTypes,
      defaultIndexType,
      dialect,
    ],
  );

  // ---- Render ----------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* FK suggestion banner */}
      {uncoveredFkColumns.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border-b text-xs text-blue-700 dark:text-blue-300">
          <IconSparkles className="h-4 w-4 flex-shrink-0" />
          <span>
            {uncoveredFkColumns.length === 1
              ? `Foreign key column "${uncoveredFkColumns[0]}" has no index.`
              : `${uncoveredFkColumns.length} foreign key columns have no indexes.`}{" "}
            <button
              type="button"
              className="underline font-medium hover:text-blue-900 dark:hover:text-blue-100"
              onClick={handleAddFkIndexes}
            >
              Add indexes
            </button>
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 min-h-0">
        <DesignerIndexContextMenu
          hoveredRowRef={contextMenuRowRef}
          onAddIndex={handleAddIndex}
          onToggleUnique={handleContextToggleUnique}
          onDeleteIndex={handleDeleteIndex}
        >
          <DataGridBase
            columns={sizedColumns}
            rowCount={gridRows.length}
            getCellContent={getCellContent}
            onCellEdited={handleCellEdited}
            onCellClicked={handleCellClick}
            customRenderers={customRenderers}
            onColumnResize={handleColumnResize}
            onColumnResizeEnd={handleColumnResizeEnd}
            onItemHovered={handleItemHovered}
            trailingRowOptions={{
              sticky: false,
              tint: false,
            }}
            onRowAppended={handleAddIndex}
            smoothScrollX
            smoothScrollY
            rowSelect="none"
            columnSelect="none"
          />
        </DesignerIndexContextMenu>
      </div>
    </div>
  );
});
