import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  GridCellKind,
  type Item,
  type CustomRenderer,
  type GridCell,
} from "@glideapps/glide-data-grid";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import type { GridColumnV2 } from "@/components/DataGrid/types";
import ColumnNameCellRenderer from "@/components/TableStructure/ColumnNameCellRenderer";
import { NullableCellRenderer } from "@/components/TableStructure/NullableCellRenderer";
import { DataTypeCellRenderer } from "@/components/TableStructure/DataTypeCellRenderer";
import DefaultValueCellRenderer from "@/components/TableStructure/DefaultValueCellRenderer";
import ForeignKeyCellRenderer from "@/components/TableStructure/ForeignKeyCellRenderer";
import CheckConstraintCellRenderer from "@/components/TableStructure/CheckConstraintCellRenderer";
import CommentCellRenderer from "@/components/TableStructure/CommentCellRenderer";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import { createTableCreateCommand } from "./commandFactory";
import type {
  CrudCommand,
  CrudCommandTarget,
  ColumnDefinitionInput,
  ForeignKeyAddPayload,
  IndexCreatePayload,
  TableCreatePayload,
} from "@/types/crud";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { IndexDesigner } from "./IndexDesigner";
import { toast } from "sonner";
import { useForeignKeyTargets } from "@/hooks/useForeignKeyTargets";
import { CrudCommandFactory } from "@/services/crudCommandFactory";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  getDesignerModifiedFields,
  syncIndexCommandsWithColumns,
  type DesignerGridRow,
  type DesignerModifiedField,
} from "./utils";

export interface TableDesignerProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  schema?: string;
  className?: string;
  onSave?: (tableName: string, sql: string) => void;
  onCancel?: () => void;
}

const createDefaultColumnDefinition = (): ColumnDefinitionInput => ({
  name: "",
  dataType: "VARCHAR(255)",
  nullable: true,
  defaultValue: undefined,
  isPrimaryKey: false,
});

const normalizeCheckConstraint = (value: string | null): string => {
  if (!value) return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^CHECK\s*\((.*)\)$/is);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
};

const sanitizeIdentifier = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

const buildForeignKeyConstraintName = (
  tableName: string,
  columnName: string,
  refTable: string,
  refColumn: string,
): string =>
  sanitizeIdentifier(`fk_${tableName}_${columnName}_${refTable}_${refColumn}`);

const parseForeignKeyValue = (
  rawValue: string,
): { schema?: string; table: string; column: string } | null => {
  const parts = rawValue
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const column = parts.pop();
  const table = parts.pop();
  if (!column || !table) return null;
  const schema = parts.length ? parts.join(".") : undefined;
  return { schema, table, column };
};

const normalizeDefaultValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
};

const buildForeignKeyValue = (payload: ForeignKeyAddPayload): string => {
  const definition = payload.definition;
  if (!definition?.columns?.length || !definition.referenceTable) return "";
  const referenceColumn = definition.referenceColumns?.[0];
  if (!referenceColumn) return "";
  const refTable = definition.referenceSchema
    ? `${definition.referenceSchema}.${definition.referenceTable}`
    : definition.referenceTable;
  return `${refTable}.${referenceColumn}`;
};

const ensureTags = (tags: string[] | undefined, next: string[]): string[] =>
  Array.from(new Set([...(tags ?? []), ...next])).filter(Boolean);

const buildFkTag = (prefix: string, index: number): string =>
  `${prefix}${index}`;

const getFkIndexFromTags = (
  tags: string[] | undefined,
  prefix: string,
): number | null => {
  const tag = tags?.find((item) => item.startsWith(prefix));
  if (!tag) return null;
  const index = Number.parseInt(tag.slice(prefix.length), 10);
  return Number.isNaN(index) ? null : index;
};

const resolveTableName = (value: string, fallback: string): string =>
  value.trim() || fallback;

const quoteIdentifier = (value: string): string =>
  `"${value.replace(/"/g, '""')}"`;

const getCommandTimestamp = (command: CrudCommand): number => {
  const raw = command.metadata.timestamp;
  const timestamp = raw ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const trailingRowTheme = {
  bgIconHeader: "#D4A52B",
};

const trailingRowOptions = {
  hint: " ",
  themeOverride: trailingRowTheme,
};

// Designer columns
const designerColumns: GridColumnV2[] = [
  {
    id: "row_number",
    field: "row_number",
    title: "#",
    name: "#",
    width: 48,
    minWidth: 48,
    maxWidth: 80,
    trailingRowOptions,
  },
  {
    id: "column_name",
    field: "column_name",
    title: "Column",
    name: "Column",
    width: 200,
    minWidth: 120,
    maxWidth: 400,
  },
  {
    id: "db_type",
    field: "db_type",
    title: "Type",
    name: "Type",
    width: 180,
    minWidth: 100,
    maxWidth: 300,
  },
  {
    id: "nullable",
    field: "nullable",
    title: "Nullable",
    name: "Nullable",
    width: 100,
    minWidth: 80,
    maxWidth: 120,
  },
  {
    id: "default",
    field: "default",
    title: "Default",
    name: "Default",
    width: 160,
    minWidth: 100,
    maxWidth: 300,
  },
  {
    id: "foreign_key",
    field: "foreign_key",
    title: "Foreign Key",
    name: "Foreign Key",
    width: 200,
    minWidth: 140,
    maxWidth: 400,
  },
  {
    id: "check_constraint",
    field: "check_constraint",
    title: "Check",
    name: "Check",
    width: 200,
    minWidth: 140,
  },
  {
    id: "comment",
    field: "comment",
    title: "Comment",
    name: "Comment",
    width: 240,
    minWidth: 140,
  },
];

export const TableDesigner: React.FC<TableDesignerProps> = ({
  panelId,
  tabId,
  connectionId,
  database,
  schema = "public",
  className,
  onSave,
  onCancel,
}) => {
  const tableNameInputRef = useRef<HTMLInputElement>(null);
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);
  const [tableNameDraft, setTableNameDraft] = useState("");
  const updateTabMetadata = useWorkbenchStore((s) => s.updateTabMetadata);
  const stagedCommands = useCrudStore((state) => state.stagedCommands);
  const stageBatchWithSingleHistoryEntry = useCrudStore(
    (state) => state.stageBatchWithSingleHistoryEntry,
  );
  const unstageCommands = useCrudStore((state) => state.unstageCommands);
  const discardChanges = useCrudStore((state) => state.discardChanges);
  const { targets: foreignKeyTargets } = useForeignKeyTargets({
    connectionId,
    database,
    schema,
  });

  const designerTag = useMemo(
    () => `table-designer:${panelId}:${tabId}`,
    [panelId, tabId],
  );
  const fkTagPrefix = useMemo(
    () => `table-designer-fk:${panelId}:${tabId}:`,
    [panelId, tabId],
  );
  const draftTableName = useMemo(() => `__new_table_${tabId}`, [tabId]);

  const designerCommands = useMemo(() => {
    const commands: CrudCommand[] = [];
    stagedCommands.forEach((items) => {
      items.forEach((command) => {
        if (command.metadata.tags?.includes(designerTag)) {
          commands.push(command);
        }
      });
    });
    return commands;
  }, [designerTag, stagedCommands]);

  const tableCreateCommands = useMemo(
    () => designerCommands.filter((cmd) => cmd.type === "table.create"),
    [designerCommands],
  );

  const tableCreateCommand = useMemo(() => {
    if (tableCreateCommands.length === 0) return undefined;
    return [...tableCreateCommands].sort(
      (a, b) => getCommandTimestamp(b) - getCommandTimestamp(a),
    )[0];
  }, [tableCreateCommands]);

  const fkCommands = useMemo(
    () => designerCommands.filter((cmd) => cmd.type === "fk.add"),
    [designerCommands],
  );

  const tableName =
    (tableCreateCommand?.payload as TableCreatePayload | undefined)
      ?.tableName ?? "";
  const tableTargetName = tableCreateCommand?.target.table ?? draftTableName;
  const effectiveTableName = tableNameDraft.trim() || tableName.trim();

  // Auto-focus on table name input
  useEffect(() => {
    tableNameInputRef.current?.focus();
  }, []);

  // Sync table name draft when staged value changes from external source (e.g., undo/redo)
  useEffect(() => {
    setTableNameDraft(tableName);
  }, [tableName]);

  useEffect(() => {
    if (tableCreateCommands.length <= 1) return;
    const sorted = [...tableCreateCommands].sort(
      (a, b) => getCommandTimestamp(b) - getCommandTimestamp(a),
    );
    const canonical = sorted[0];
    if (!canonical) return;

    const duplicateIds = tableCreateCommands
      .filter((cmd) => cmd.id !== canonical.id)
      .map((cmd) => cmd.id);
    if (duplicateIds.length > 0) {
      unstageCommands(duplicateIds);
    }
  }, [tableCreateCommands, unstageCommands]);

  const buildDesignerCreateCommand = useCallback(
    (
      target: CrudCommandTarget,
      payload: {
        tableName: string;
        columns: ColumnDefinitionInput[];
        primaryKey?: string[];
        ifNotExists?: boolean;
      },
    ) => {
      const createCommand = createTableCreateCommand(target, payload);
      return {
        ...createCommand,
        // Stable ID keeps initialization idempotent under StrictMode/effect replay.
        id: `${designerTag}:table.create`,
        metadata: {
          ...createCommand.metadata,
          tags: ensureTags(createCommand.metadata.tags, [designerTag]),
        },
      };
    },
    [designerTag],
  );

  useEffect(() => {
    if (!connectionId || !database || tableCreateCommand) return;

    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table: draftTableName,
    };

    const defaultColumns = [
      {
        name: "id",
        dataType: "SERIAL",
        nullable: false,
        defaultValue: undefined,
        isPrimaryKey: true,
      },
    ] satisfies ColumnDefinitionInput[];

    const createCommand = buildDesignerCreateCommand(target, {
      tableName: "",
      columns: defaultColumns,
      primaryKey: ["id"],
    });

    stageBatchWithSingleHistoryEntry([createCommand]);
  }, [
    buildDesignerCreateCommand,
    connectionId,
    database,
    draftTableName,
    schema,
    stageBatchWithSingleHistoryEntry,
    tableCreateCommand,
  ]);

  const columns = useMemo(
    () =>
      (tableCreateCommand?.payload as TableCreatePayload | undefined)
        ?.columns ?? [],
    [tableCreateCommand],
  );

  const baselineColumnsRef = useRef<ColumnDefinitionInput[]>([]);

  useEffect(() => {
    if (columns.length === 0) {
      return;
    }

    if (baselineColumnsRef.current.length === 0) {
      baselineColumnsRef.current = columns.map((col) => ({ ...col }));
      return;
    }

    if (columns.length > baselineColumnsRef.current.length) {
      for (
        let i = baselineColumnsRef.current.length;
        i < columns.length;
        i += 1
      ) {
        baselineColumnsRef.current[i] = createDefaultColumnDefinition();
      }
    } else if (columns.length < baselineColumnsRef.current.length) {
      baselineColumnsRef.current = baselineColumnsRef.current.slice(
        0,
        columns.length,
      );
    }
  }, [columns]);

  const primaryKeySet = useMemo(
    () =>
      new Set(
        (tableCreateCommand?.payload as TableCreatePayload | undefined)
          ?.primaryKey ?? [],
      ),
    [tableCreateCommand],
  );

  const foreignKeyByIndex = useMemo(() => {
    const map = new Map<number, string>();
    fkCommands.forEach((cmd) => {
      const index = getFkIndexFromTags(cmd.metadata.tags, fkTagPrefix);
      if (index === null) return;
      const value = buildForeignKeyValue(cmd.payload as ForeignKeyAddPayload);
      if (value) {
        map.set(index, value);
      }
    });
    return map;
  }, [fkCommands, fkTagPrefix]);

  const foreignKeyByColumnName = useMemo(() => {
    const map = new Map<string, string>();
    fkCommands.forEach((cmd) => {
      const payload = cmd.payload as ForeignKeyAddPayload;
      const columnName = payload.definition?.columns?.[0];
      if (!columnName) return;
      const value = buildForeignKeyValue(payload);
      if (value) {
        map.set(columnName, value);
      }
    });
    return map;
  }, [fkCommands]);

  const gridRows = useMemo((): DesignerGridRow[] => {
    return columns.map((col, index) => {
      const columnName = col.name ?? "";
      const isPrimaryKey =
        Boolean(col.isPrimaryKey) ||
        primaryKeySet.has(columnName) ||
        (col.dataType ?? "").toUpperCase().includes("SERIAL");
      const fkValue =
        foreignKeyByIndex.get(index) ||
        (columnName ? foreignKeyByColumnName.get(columnName) : "") ||
        "";

      return {
        row_number: index + 1,
        column_name: columnName,
        column_meta: {
          is_pk: isPrimaryKey,
          is_fk: Boolean(fkValue),
        },
        db_type: col.dataType || "VARCHAR(255)",
        nullable: !col.nullable ? "NO" : "YES",
        default: normalizeDefaultValue(col.defaultValue),
        foreign_key: fkValue,
        check_constraint: col.checkExpression ?? "",
        comment: col.comment ?? "",
        _tempId: `${index}`,
      };
    });
  }, [columns, foreignKeyByColumnName, foreignKeyByIndex, primaryKeySet]);

  // Column names for IndexDesigner's column picker
  const availableColumnNames = useMemo(
    () => columns.filter((c) => c.name.trim()).map((c) => c.name),
    [columns],
  );

  // FK column names for auto-suggest
  const foreignKeyColumnNames = useMemo(() => {
    const fkCols: string[] = [];
    fkCommands.forEach((cmd) => {
      const payload = cmd.payload as ForeignKeyAddPayload;
      const colName = payload.definition?.columns?.[0];
      if (colName) fkCols.push(colName);
    });
    return fkCols;
  }, [fkCommands]);

  // Count index commands for tab badge
  const indexCommandCount = useMemo(
    () => designerCommands.filter((cmd) => cmd.type === "index.create").length,
    [designerCommands],
  );

  // Track previous column names for rename detection
  const prevColumnNamesRef = useRef<string[]>([]);

  useEffect(() => {
    const currentNames = availableColumnNames;
    const prevNames = prevColumnNamesRef.current;
    prevColumnNamesRef.current = currentNames;

    // Skip first render or when no index commands
    if (prevNames.length === 0 || indexCommandCount === 0) return;

    // Build rename map: detect 1:1 positional renames
    const renames = new Map<string, string>();
    const minLen = Math.min(prevNames.length, currentNames.length);
    for (let i = 0; i < minLen; i++) {
      if (prevNames[i] && currentNames[i] && prevNames[i] !== currentNames[i]) {
        // Only treat as rename if old name no longer exists anywhere
        if (!currentNames.includes(prevNames[i]!)) {
          renames.set(prevNames[i]!, currentNames[i]!);
        }
      }
    }

    // Get current index commands from designerCommands
    const currentIndexCommands = designerCommands.filter(
      (cmd) => cmd.type === "index.create",
    );

    if (currentIndexCommands.length === 0) return;

    const synced = syncIndexCommandsWithColumns(
      currentIndexCommands,
      currentNames,
      renames,
    );

    if (!synced) return;

    // Find removed command IDs (commands excluded from synced result)
    const syncedIds = new Set(synced.map((c) => c.id));
    const removedIds = currentIndexCommands
      .filter((c) => !syncedIds.has(c.id))
      .map((c) => c.id);

    if (removedIds.length > 0) {
      unstageCommands(removedIds);
    }

    // Stage only commands that actually changed
    const updatedCommands = synced.filter((c) => {
      const original = currentIndexCommands.find((orig) => orig.id === c.id);
      return original !== c; // reference equality — changed commands are new objects
    });

    if (updatedCommands.length > 0) {
      stageBatchWithSingleHistoryEntry(updatedCommands);
    }
  }, [
    availableColumnNames,
    designerCommands,
    indexCommandCount,
    stageBatchWithSingleHistoryEntry,
    unstageCommands,
  ]);

  const fkCommandByIndex = useMemo(() => {
    const map = new Map<number, CrudCommand>();
    fkCommands.forEach((cmd) => {
      const index = getFkIndexFromTags(cmd.metadata.tags, fkTagPrefix);
      if (index === null) return;
      map.set(index, cmd);
    });
    return map;
  }, [fkCommands, fkTagPrefix]);

  const fkCommandByColumnName = useMemo(() => {
    const map = new Map<string, CrudCommand>();
    fkCommands.forEach((cmd) => {
      const payload = cmd.payload as ForeignKeyAddPayload;
      const columnName = payload.definition?.columns?.[0];
      if (!columnName) return;
      map.set(columnName, cmd);
    });
    return map;
  }, [fkCommands]);

  const resolveTargetTableName = useCallback(
    (nextTableName: string) => resolveTableName(nextTableName, draftTableName),
    [draftTableName],
  );

  const buildTableCreateCommand = useCallback(
    (nextColumns: ColumnDefinitionInput[], nextTableName: string) => {
      if (!tableCreateCommand) return null;

      const trimmedName = nextTableName.trim();
      const primaryKey = nextColumns
        .filter((col) => col.isPrimaryKey && col.name)
        .map((col) => col.name);

      const payload = {
        ...(tableCreateCommand.payload as TableCreatePayload),
        tableName: trimmedName,
        columns: nextColumns,
        primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
      };

      return {
        ...tableCreateCommand,
        target: {
          ...tableCreateCommand.target,
          table: resolveTargetTableName(trimmedName),
        },
        payload,
        metadata: {
          ...tableCreateCommand.metadata,
          description: `Create table ${trimmedName || "New Table"}`,
          tags: ensureTags(tableCreateCommand.metadata.tags, [designerTag]),
        },
      };
    },
    [designerTag, resolveTargetTableName, tableCreateCommand],
  );

  const buildForeignKeyCommand = useCallback(
    (
      index: number,
      value: string,
      columnName: string,
      currentCommand?: CrudCommand,
      nextTableName?: string,
    ) => {
      const resolvedNextTableName = nextTableName ?? tableName;
      if (!tableCreateCommand) return null;
      if (!columnName) return null;

      const parsed = parseForeignKeyValue(value);
      if (!parsed) return { error: "invalid" } as const;

      const trimmedTableName = resolvedNextTableName.trim();
      const resolvedTableName = resolveTargetTableName(
        trimmedTableName || resolvedNextTableName,
      );
      const constraintName = buildForeignKeyConstraintName(
        trimmedTableName || resolvedTableName,
        columnName,
        parsed.table,
        parsed.column,
      );
      const definition = {
        name: constraintName,
        columns: [columnName],
        referenceTable: parsed.table,
        referenceSchema: parsed.schema,
        referenceColumns: [parsed.column],
      };

      const baseCommand =
        currentCommand ??
        CrudCommandFactory.createForeignKeyAddCommand({
          target: {
            ...tableCreateCommand.target,
            table: resolvedTableName,
          },
          definition,
        });

      const fkTag = buildFkTag(fkTagPrefix, index);
      return {
        ...baseCommand,
        id: currentCommand?.id ?? `${tableCreateCommand.id}:fk:${index}`,
        target: {
          ...baseCommand.target,
          table: resolvedTableName,
        },
        payload: {
          ...(baseCommand.payload as ForeignKeyAddPayload),
          definition,
        },
        metadata: {
          ...baseCommand.metadata,
          tags: ensureTags(baseCommand.metadata.tags, [designerTag, fkTag]),
        },
      };
    },
    [
      designerTag,
      fkTagPrefix,
      resolveTargetTableName,
      tableCreateCommand,
      tableName,
    ],
  );

  // Column sizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: designerColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // Custom renderers
  const customRenderers = useMemo(
    () => [
      ColumnNameCellRenderer as unknown as CustomRenderer,
      DefaultValueCellRenderer as unknown as CustomRenderer,
      ForeignKeyCellRenderer as unknown as CustomRenderer,
      CheckConstraintCellRenderer as unknown as CustomRenderer,
      CommentCellRenderer as unknown as CustomRenderer,
      NullableCellRenderer as unknown as CustomRenderer,
      DataTypeCellRenderer as unknown as CustomRenderer,
    ],
    [],
  );

  // Get cell content
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = gridRows[row];
      if (!rowData) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
        };
      }

      const column = sizedColumns[col];
      const field = column?.field;
      const baseline = baselineColumnsRef.current[row];
      const modifiedFields = getDesignerModifiedFields(rowData, baseline);
      const isCellModified = Boolean(
        field && modifiedFields.has(field as DesignerModifiedField),
      );
      const cellThemeOverride = isCellModified
        ? {
            bgCell: "rgba(251, 146, 60, 0.15)", // orange highlight
            accentColor: "#fb923c",
            accentLight: "rgba(251, 146, 60, 0.2)",
          }
        : undefined;

      switch (field) {
        case "row_number":
          return {
            kind: GridCellKind.Number,
            data: rowData.row_number,
            displayData: String(rowData.row_number),
            allowOverlay: false,
            readonly: true,
          };

        case "column_name":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "column-name-cell",
              name: rowData.column_name || "",
              isPrimaryKey: rowData.column_meta.is_pk,
              isForeignKey: rowData.column_meta.is_fk,
            },
            copyData: rowData.column_name || "",
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        case "db_type":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "datatype-cell",
              value: rowData.db_type,
              columnName: rowData.column_name,
            },
            copyData: rowData.db_type,
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        case "nullable":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "nullable-cell",
              value: rowData.nullable,
              columnName: rowData.column_name,
            },
            copyData: rowData.nullable,
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        case "default":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "default-value-cell",
              value: rowData.default?.trim() ? rowData.default : null,
              columnName: rowData.column_name,
              dbType: rowData.db_type,
            },
            copyData: rowData.default?.trim() ? rowData.default : "NULL",
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        case "foreign_key":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "foreign-key-cell",
              value: rowData.foreign_key || "",
              suggestions: foreignKeyTargets,
              columnName: rowData.column_name,
            },
            copyData: rowData.foreign_key || "",
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        case "check_constraint": {
          const normalizedValue = normalizeCheckConstraint(
            rowData.check_constraint,
          );
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "check-constraint-cell",
              value: normalizedValue || null,
              columnName: rowData.column_name,
            },
            copyData: normalizedValue,
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };
        }

        case "comment":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "comment-cell",
              value: rowData.comment || null,
              columnName: rowData.column_name,
            },
            copyData: rowData.comment || "",
            allowOverlay: true,
            themeOverride: cellThemeOverride,
          };

        default:
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
            allowOverlay: false,
          };
      }
    },
    [gridRows, sizedColumns, foreignKeyTargets],
  );

  // Handle cell edit
  const handleCellEdited = useCallback(
    ([col, row]: Item, newValue: GridCell) => {
      if (!tableCreateCommand) return;

      const column = sizedColumns[col];
      const field = column?.field;
      const current = columns[row];

      if (!field || !current) return;

      const nextColumns = [...columns];
      const updated = { ...current };
      const commands: CrudCommand[] = [];

      const getStringValue = (): string => {
        if (newValue.kind === GridCellKind.Custom) {
          const data = newValue.data as { name?: string; value?: string };
          return data.name || data.value || "";
        }
        if (newValue.kind === GridCellKind.Text) {
          return newValue.data || "";
        }
        return "";
      };

      if (field === "foreign_key") {
        const newForeignKey = getStringValue().trim();
        const existingFkCommand =
          fkCommandByIndex.get(row) ||
          (current.name ? fkCommandByColumnName.get(current.name) : undefined);

        if (!newForeignKey) {
          if (existingFkCommand) {
            unstageCommands([existingFkCommand.id]);
          }
          return;
        }

        if (!current.name) {
          toast.error("Set a column name before adding a foreign key");
          return;
        }

        const fkCommand = buildForeignKeyCommand(
          row,
          newForeignKey,
          current.name,
          existingFkCommand,
        );

        if (fkCommand && "error" in fkCommand) {
          toast.error("Invalid foreign key format", {
            description: "Use table.column or schema.table.column",
          });
          return;
        }

        if (fkCommand) {
          commands.push(fkCommand as CrudCommand);
        }

        if (commands.length > 0) {
          stageBatchWithSingleHistoryEntry(commands);
        }
        return;
      }

      switch (field) {
        case "column_name": {
          const nextName = getStringValue();
          updated.name = nextName;
          nextColumns[row] = updated;

          const updatedCreate = buildTableCreateCommand(nextColumns, tableName);
          const existingFkValue =
            foreignKeyByIndex.get(row) ||
            (current.name
              ? foreignKeyByColumnName.get(current.name)
              : undefined);
          const existingFkCommand =
            fkCommandByIndex.get(row) ||
            (current.name
              ? fkCommandByColumnName.get(current.name)
              : undefined);

          if (existingFkCommand) {
            if (!nextName.trim() || !existingFkValue) {
              unstageCommands([existingFkCommand.id]);
            } else {
              const fkCommand = buildForeignKeyCommand(
                row,
                existingFkValue,
                nextName,
                existingFkCommand,
              );
              if (fkCommand && !("error" in fkCommand)) {
                commands.push(fkCommand as CrudCommand);
              }
            }
          }

          if (updatedCreate) {
            commands.unshift(updatedCreate);
          }
          break;
        }

        case "db_type": {
          const nextType = getStringValue() || "VARCHAR(255)";
          updated.dataType = nextType;
          updated.isPrimaryKey = nextType.toUpperCase().includes("SERIAL");
          break;
        }

        case "nullable":
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string };
            updated.nullable = data.value === "YES";
          }
          break;

        case "default": {
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string | null };
            const rawValue = data.value ?? "";
            updated.defaultValue = rawValue.trim() ? rawValue : undefined;
          } else if (newValue.kind === GridCellKind.Text) {
            const rawValue = newValue.data || "";
            updated.defaultValue = rawValue.trim() ? rawValue : undefined;
          }
          break;
        }

        case "check_constraint": {
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string | null };
            const rawValue = data.value ?? "";
            updated.checkExpression = rawValue.trim()
              ? normalizeCheckConstraint(rawValue)
              : undefined;
          } else if (newValue.kind === GridCellKind.Text) {
            const rawValue = newValue.data || "";
            updated.checkExpression = rawValue.trim()
              ? normalizeCheckConstraint(rawValue)
              : undefined;
          }
          break;
        }

        case "comment": {
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string | null };
            const rawValue = data.value ?? "";
            updated.comment = rawValue.trim() ? rawValue : undefined;
          } else if (newValue.kind === GridCellKind.Text) {
            const rawValue = newValue.data || "";
            updated.comment = rawValue.trim() ? rawValue : undefined;
          }
          break;
        }
      }

      if (field !== "column_name") {
        nextColumns[row] = updated;
        const updatedCreate = buildTableCreateCommand(nextColumns, tableName);
        if (updatedCreate) {
          commands.push(updatedCreate);
        }
      }

      if (commands.length > 0) {
        stageBatchWithSingleHistoryEntry(commands);
      }
    },
    [
      buildForeignKeyCommand,
      buildTableCreateCommand,
      columns,
      fkCommandByColumnName,
      fkCommandByIndex,
      foreignKeyByColumnName,
      foreignKeyByIndex,
      stageBatchWithSingleHistoryEntry,
      tableCreateCommand,
      tableName,
      unstageCommands,
      sizedColumns,
    ],
  );

  // Handle row append
  const handleRowAppended = useCallback(() => {
    if (!tableCreateCommand) return;
    const nextColumns = [...columns, createDefaultColumnDefinition()];
    const updatedCreate = buildTableCreateCommand(nextColumns, tableName);
    if (updatedCreate) {
      stageBatchWithSingleHistoryEntry([updatedCreate]);
    }
  }, [
    buildTableCreateCommand,
    columns,
    stageBatchWithSingleHistoryEntry,
    tableCreateCommand,
    tableName,
  ]);

  const handleTableNameChange = useCallback(
    (nextName: string) => {
      if (!tableCreateCommand) {
        if (!connectionId || !database) return;

        const target: CrudCommandTarget = {
          connectionId,
          database,
          schema,
          table: resolveTargetTableName(nextName),
        };

        const defaultColumns = [
          {
            name: "id",
            dataType: "SERIAL",
            nullable: false,
            defaultValue: undefined,
            isPrimaryKey: true,
          },
        ] satisfies ColumnDefinitionInput[];

        const createCommand = buildDesignerCreateCommand(target, {
          tableName: nextName.trim(),
          columns: defaultColumns,
          primaryKey: ["id"],
        });

        stageBatchWithSingleHistoryEntry([createCommand]);
        return;
      }
      if (nextName === tableName) return;

      const updatedCreate = buildTableCreateCommand(columns, nextName);
      if (!updatedCreate) return;

      const updatedCommands: CrudCommand[] = [updatedCreate];
      fkCommands.forEach((cmd) => {
        const payload = cmd.payload as ForeignKeyAddPayload;
        const fkValue = buildForeignKeyValue(payload);
        if (!fkValue) return;

        const indexFromTag = getFkIndexFromTags(cmd.metadata.tags, fkTagPrefix);
        const columnName =
          (indexFromTag !== null ? columns[indexFromTag]?.name : undefined) ??
          payload.definition?.columns?.[0];
        if (!columnName) return;

        const resolvedIndex =
          indexFromTag !== null
            ? indexFromTag
            : columns.findIndex((col) => col.name === columnName);
        if (resolvedIndex < 0) return;

        const updatedFk = buildForeignKeyCommand(
          resolvedIndex,
          fkValue,
          columnName,
          cmd,
          nextName,
        );
        if (updatedFk && !("error" in updatedFk)) {
          updatedCommands.push(updatedFk as CrudCommand);
        }
      });

      stageBatchWithSingleHistoryEntry(updatedCommands);
    },
    [
      buildDesignerCreateCommand,
      buildForeignKeyCommand,
      buildTableCreateCommand,
      columns,
      connectionId,
      database,
      fkCommands,
      fkTagPrefix,
      resolveTargetTableName,
      stageBatchWithSingleHistoryEntry,
      schema,
      tableCreateCommand,
      tableName,
    ],
  );

  const commitTableNameDraft = useCallback(
    (nextName: string) => {
      const trimmedName = nextName.trim();
      if (nextName !== tableName) {
        handleTableNameChange(nextName);
      }
      updateTabMetadata(panelId, tabId, {
        title: trimmedName || "New Table",
        table: trimmedName || undefined,
      });
    },
    [handleTableNameChange, panelId, tabId, tableName, updateTabMetadata],
  );

  // Handle blur - update crud store and tab title
  const handleTableNameBlur = useCallback(() => {
    commitTableNameDraft(tableNameDraft);
  }, [commitTableNameDraft, tableNameDraft]);

  // Generate SQL
  const generateSQL = useCallback(
    (tableNameOverride?: string) => {
      const resolvedTableName = (
        tableNameOverride ?? tableName
      ).trim();
      if (!resolvedTableName || gridRows.length === 0) return "";

      const pkColumns = gridRows
        .filter((r) => r.column_meta.is_pk)
        .map((r) => r.column_name);

      const columnDefs = gridRows
        .map((col) => {
          let def = `  ${quoteIdentifier(col.column_name)} ${col.db_type}`;
          if (col.nullable === "NO") def += " NOT NULL";
          if (col.default?.trim()) def += ` DEFAULT ${col.default.trim()}`;
          if (col.check_constraint?.trim()) {
            def += ` CHECK (${normalizeCheckConstraint(col.check_constraint)})`;
          }
          return def;
        })
        .join(",\n");

      const pkConstraint =
        pkColumns.length > 0
          ? `,\n  PRIMARY KEY (${pkColumns
              .map((c) => quoteIdentifier(c))
              .join(", ")})`
          : "";

      const foreignKeyConstraints = gridRows
        .map((col) => {
          if (!col.foreign_key) return null;
          const parsed = parseForeignKeyValue(col.foreign_key);
          if (!parsed) return null;
          const tableRef = parsed.schema
            ? `${quoteIdentifier(parsed.schema)}.${quoteIdentifier(parsed.table)}`
            : quoteIdentifier(parsed.table);
          return `  FOREIGN KEY (${quoteIdentifier(
            col.column_name,
          )}) REFERENCES ${tableRef} (${quoteIdentifier(parsed.column)})`;
        })
        .filter((constraint): constraint is string => Boolean(constraint))
        .join(",\n");

      const allConstraints = [pkConstraint.trim(), foreignKeyConstraints]
        .filter(Boolean)
        .map((constraint) =>
          constraint.startsWith(",") ? constraint : `,\n${constraint}`,
        )
        .join("");

      const createTable = `CREATE TABLE ${quoteIdentifier(
        schema,
      )}.${quoteIdentifier(resolvedTableName)} (\n${columnDefs}${allConstraints}\n);`;

      const commentStatements = gridRows
        .map((col) => {
          if (!col.comment || !col.comment.trim()) return null;
          const columnRef = `${quoteIdentifier(schema)}.${quoteIdentifier(
            resolvedTableName,
          )}.${quoteIdentifier(col.column_name)}`;
          const escaped = col.comment.replace(/'/g, "''");
          return `COMMENT ON COLUMN ${columnRef} IS '${escaped}';`;
        })
        .filter((statement): statement is string => Boolean(statement));

      // Generate CREATE INDEX statements from staged index commands
      const indexStatements = designerCommands
        .filter((cmd) => cmd.type === "index.create")
        .map((cmd) => {
          const payload = cmd.payload as IndexCreatePayload;
          const def = payload.definition;
          if (!def.name || def.columns.length === 0) return null;

          const uniqueKeyword = def.unique ? "UNIQUE " : "";
          const cols = def.columns.map((c) => quoteIdentifier(c)).join(", ");
          const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier(resolvedTableName)}`;
          const usingClause = def.using && def.using !== "btree" ? ` USING ${def.using}` : "";
          const whereClause = def.where ? ` WHERE ${def.where}` : "";

          return `CREATE ${uniqueKeyword}INDEX ${quoteIdentifier(def.name)} ON ${tableRef}${usingClause} (${cols})${whereClause};`;
        })
        .filter((s): s is string => Boolean(s));

      return [createTable, ...commentStatements, ...indexStatements].join("\n");
    },
    [tableName, gridRows, schema, designerCommands],
  );

  const handleSave = useCallback(() => {
    if (!effectiveTableName) {
      toast.error("Please enter a table name");
      tableNameInputRef.current?.focus();
      return;
    }
    if (columns.length === 0) {
      toast.error("Please add at least one column");
      return;
    }

    // Validate all columns have names
    const invalidColumns = columns.filter((col) => !col.name.trim());
    if (invalidColumns.length > 0) {
      toast.error("All columns must have names");
      return;
    }

    const invalidForeignKeys = new Set<string>();

    gridRows.forEach((col) => {
      const rawValue = col.foreign_key?.trim();
      if (!rawValue) return;
      const parsed = parseForeignKeyValue(rawValue);
      if (!parsed) {
        invalidForeignKeys.add(rawValue);
        return;
      }
    });

    if (invalidForeignKeys.size > 0) {
      toast.error("Invalid foreign key format", {
        description: "Use table.column or schema.table.column",
      });
      return;
    }

    // Validate indexes
    const invalidIndexes: string[] = [];
    const indexNames = new Set<string>();

    const currentIndexCommands = designerCommands.filter(
      (cmd) => cmd.type === "index.create",
    );

    currentIndexCommands.forEach((cmd) => {
      const payload = cmd.payload as IndexCreatePayload;
      const def = payload.definition;
      if (!def.name.trim()) {
        invalidIndexes.push("An index is missing a name");
      }
      if (def.columns.length === 0) {
        invalidIndexes.push(`Index "${def.name || "(unnamed)"}" has no columns`);
      }
      const missingCols = def.columns.filter(
        (c) => !availableColumnNames.includes(c),
      );
      if (missingCols.length > 0) {
        invalidIndexes.push(
          `Index "${def.name}" references non-existent column(s): ${missingCols.join(", ")}`,
        );
      }
      if (def.name && indexNames.has(def.name)) {
        invalidIndexes.push(`Duplicate index name: "${def.name}"`);
      }
      if (def.name) indexNames.add(def.name);
    });

    if (invalidIndexes.length > 0) {
      toast.error("Invalid index definitions", {
        description: invalidIndexes[0],
      });
      return;
    }

    if (tableNameDraft !== tableName) {
      commitTableNameDraft(tableNameDraft);
    }

    setGlobalChangesDialogOpen(true);
  }, [
    availableColumnNames,
    columns,
    commitTableNameDraft,
    designerCommands,
    effectiveTableName,
    gridRows,
    tableName,
    tableNameDraft,
  ]);

  const handleCancel = useCallback(() => {
    if (designerCommands.length > 0) {
      unstageCommands(designerCommands.map((cmd) => cmd.id));
    }
    onCancel?.();
  }, [designerCommands, onCancel, unstageCommands]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}

      <div className="flex items-center gap-2 py-1 px-0.5">
        <Input
          ref={tableNameInputRef}
          id="tableName"
          value={tableNameDraft}
          onChange={(e) => {
            setTableNameDraft(e.target.value);
          }}
          onBlur={handleTableNameBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTableNameDraft(e.currentTarget.value);
              e.currentTarget.blur();
              return;
            }

            if (e.key === "Tab") {
              commitTableNameDraft(e.currentTarget.value);
              return;
            }

            if (e.key === "Escape") {
              e.preventDefault();
              setTableNameDraft(tableName);
              e.currentTarget.blur();
              return;
            }

            if (e.key === " ") {
              e.preventDefault();
              const input = e.currentTarget;
              const start = input.selectionStart ?? input.value.length;
              const end = input.selectionEnd ?? start;
              input.value =
                input.value.slice(0, start) + "_" + input.value.slice(end);
              input.setSelectionRange(start + 1, start + 1);
              setTableNameDraft(input.value);
            }
          }}
          placeholder="Enter table name"
        />
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="columns" className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-0.5 w-fit">
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="indexes">
            Indexes{indexCommandCount > 0 ? ` (${indexCommandCount})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="columns" className="flex-1 min-h-0 mt-0" keepMounted>
          <DataGridBase
            columns={sizedColumns}
            rowCount={gridRows.length}
            getCellContent={getCellContent}
            onCellEdited={handleCellEdited}
            customRenderers={customRenderers}
            onColumnResize={handleColumnResize}
            onColumnResizeEnd={handleColumnResizeEnd}
            trailingRowOptions={{
              sticky: false,
              tint: false,
            }}
            onRowAppended={handleRowAppended}
            smoothScrollX
            smoothScrollY
            rowSelect="none"
            columnSelect="none"
          />
        </TabsContent>

        <TabsContent value="indexes" className="flex-1 min-h-0 mt-0">
          <IndexDesigner
            panelId={panelId}
            tabId={tabId}
            connectionId={connectionId}
            database={database}
            schema={schema}
            availableColumns={availableColumnNames}
            tableName={effectiveTableName}
            foreignKeyColumns={foreignKeyColumnNames}
            designerTag={designerTag}
          />
        </TabsContent>
      </Tabs>

      {/* Footer Actions */}
      <div className="flex-none p-3 border-t flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!effectiveTableName || columns.length === 0}
        >
          Create Table
        </Button>
      </div>

      <GlobalChangesDialog
        open={globalChangesDialogOpen}
        onOpenChange={setGlobalChangesDialogOpen}
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={tableTargetName}
        onCommitSuccess={() => {
          const finalTableName = effectiveTableName;
          const sql = generateSQL(finalTableName);
          onSave?.(finalTableName, sql);
          const committedTableKey = buildCrudTableKey({
            connectionId,
            database,
            schema,
            table: resolveTargetTableName(finalTableName),
          });
          discardChanges(committedTableKey);
          setGlobalChangesDialogOpen(false);
        }}
      />
    </div>
  );
};

export default TableDesigner;
