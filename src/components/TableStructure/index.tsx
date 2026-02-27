import { logger } from "@/lib/logger";
import {
  memo,
  useMemo,
  useCallback,
  useState,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import { useGridPreferencesHydrated } from "@/components/DataGrid/stores/gridPreferencesSelectors";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
} from "@glideapps/glide-data-grid";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { useForeignKeyTargets } from "@/hooks/useForeignKeyTargets";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { NullableCellRenderer } from "./NullableCellRenderer";
import { DataTypeCellRenderer } from "./DataTypeCellRenderer";
import { ActionsCellRenderer } from "./ActionsCellRenderer";
import { getStructureColumns } from "./columns";
import {
  transformStructureToRows,
  buildStructureModifiedFieldsMap,
  type StructureModifiedField,
} from "./utils";
import ColumnNameCellRenderer from "./ColumnNameCellRenderer";
import DefaultValueCellRenderer from "./DefaultValueCellRenderer";
import ForeignKeyCellRenderer from "./ForeignKeyCellRenderer";
import CheckConstraintCellRenderer from "./CheckConstraintCellRenderer";
import CommentCellRenderer from "./CommentCellRenderer";
import type { StructureGridRow } from "./types";
import { validateColumnName } from "./types";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import {
  createColumnAddCommand,
  createColumnModifyCommand,
  createColumnDropCommand,
  createColumnRenameCommand,
  generateCommandId,
} from "./commandFactory";
import { CrudCommandFactory } from "@/services/crudCommandFactory";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { BatchActionsToolbar } from "./BatchActionsToolbar";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { contextService } from "@/services/contextService";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type {
  CrudCommandTarget,
  ColumnAddPayload,
  ColumnDropPayload,
  ForeignKeyDefinitionInput,
  TableRenamePayload,
} from "@/types/crud";
import {
  CompactSelection,
  type GridSelection,
} from "@glideapps/glide-data-grid";

type AnyCell = CustomCell<Record<string, unknown>>;

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

const validateTableName = (
  name: string,
): { valid: boolean; error?: string } => {
  if (!name || name.trim() === "") {
    return { valid: false, error: "Table name is required" };
  }

  const trimmedName = name.trim();

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
    return {
      valid: false,
      error:
        "Table name must start with a letter or underscore and contain only letters, numbers, and underscores",
    };
  }

  const reservedKeywords = [
    "select",
    "from",
    "where",
    "insert",
    "update",
    "delete",
    "table",
    "column",
    "index",
    "primary",
    "foreign",
    "key",
    "constraint",
    "create",
    "drop",
    "alter",
    "null",
    "not",
    "and",
    "or",
    "order",
    "by",
  ];

  if (reservedKeywords.includes(trimmedName.toLowerCase())) {
    return {
      valid: false,
      error: `"${trimmedName}" is a reserved SQL keyword`,
    };
  }

  return { valid: true };
};

interface TableStructureProps {
  panelId?: string;
  tabId?: string;
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableStructure = memo(function TableStructure({
  panelId,
  tabId,
  connectionId,
  database,
  table,
  schema,
  isView = false,
  kind,
  onActionsChange: _onActionsChange,
}: TableStructureProps) {
  // Determine entity type for read-only behavior
  const entityType: "table" | "view" | "materialized_view" =
    kind === "MaterializedView"
      ? "materialized_view"
      : kind === "View" || isView
      ? "view"
      : "table";

  const isReadOnly = entityType !== "table";
  
  // Get database type for column configuration
  const connection = useConnectionStore((state) =>
    state.connections.find((c) => c.profile.id === connectionId),
  );
  const dbType = connection?.profile.db_type;
  
  // Get structure columns based on database type
  const structureColumns = useMemo(() => getStructureColumns(dbType), [dbType]);
  
  const { structure, isLoading, error, refresh } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeConstraints: true,
      includeForeignKeys: true,
    },
  });

  const { targets: foreignKeyTargets } = useForeignKeyTargets({
    connectionId,
    database,
    schema,
  });

  const { stagedCommands, stageCommand, unstageCommand, discardChanges } =
    useCrudStore();
  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );

  // Grid ID for structure search persistence
  const structureGridId = `${connectionId}:${database}:${schema}:${table}:structure`;

  // Hydration and persisted search state
  const hydrated = useGridPreferencesHydrated();
  const persistedSearch = useGridPreferencesStore(
    (state) => state.preferences[structureGridId]?.structureSearch ?? ""
  );
  const setStructureSearch = useGridPreferencesStore((state) => state.setStructureSearch);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StructureGridRow | null>(
    null,
  );
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);
  const [selection, setSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  // Search query with persistence - initialize from persisted value after hydration
  const [searchQuery, setSearchQueryLocal] = useState("");

  // Sync search query from persisted state after hydration
  useEffect(() => {
    if (hydrated && persistedSearch && !searchQuery) {
      setSearchQueryLocal(persistedSearch);
    }
  }, [hydrated, persistedSearch, searchQuery]);

  // Persist search query changes (debounced via useDeferredValue won't work for this, use direct)
  const handleSearchChange = useCallback((value: string) => {
    setSearchQueryLocal(value);
    setStructureSearch(structureGridId, value || undefined);
  }, [structureGridId, setStructureSearch]);

  const columns = useMemo(() => structure?.columns ?? [], [structure?.columns]);
  const foreignKeys = useMemo(
    () => structure?.foreignKeys ?? [],
    [structure?.foreignKeys],
  );
  const constraints = useMemo(
    () => structure?.constraints ?? [],
    [structure?.constraints],
  );

  // Get pending commands for this table - FIX: subscribe to stagedCommands directly
  const tableKey = useMemo(
    () => buildCrudTableKey({ connectionId, database, schema, table }),
    [connectionId, database, schema, table],
  );

  const pendingCommands = useMemo(() => {
    return stagedCommands.get(tableKey) ?? [];
  }, [stagedCommands, tableKey]);

  const modifiedFieldsByColumn = useMemo(
    () => buildStructureModifiedFieldsMap(pendingCommands, foreignKeys),
    [pendingCommands, foreignKeys],
  );

  const pendingTableRename = useMemo(
    () => pendingCommands.find((cmd) => cmd.type === "table.rename"),
    [pendingCommands],
  );

  const pendingTableName = useMemo(() => {
    if (!pendingTableRename) return null;
    const payload = pendingTableRename.payload as TableRenamePayload;
    return payload.newName ?? null;
  }, [pendingTableRename]);

  const [tableNameDraft, setTableNameDraft] = useState(
    pendingTableName ?? table,
  );

  useEffect(() => {
    setTableNameDraft(pendingTableName ?? table);
  }, [pendingTableName, table]);

  const tableRenameTarget = useMemo(
    () => ({
      connectionId,
      database,
      schema,
      table,
    }),
    [connectionId, database, schema, table],
  );

  useEffect(() => {
    const unsubscribe = useDataInvalidationStore
      .getState()
      .subscribe(
        connectionId,
        database,
        schema ?? "public",
        table,
        async () => {
          await refresh();
          const { clearCommittedChanges, getTableKey } =
            useCrudStore.getState();
          const commitTableKey = getTableKey({
            connectionId,
            database,
            schema: schema ?? "public",
            table,
          });
          clearCommittedChanges(commitTableKey);
        },
      );

    return unsubscribe;
  }, [connectionId, database, schema, table, refresh]);

  // Collect custom/enum types from existing columns
  const customTypes = useMemo(() => {
    const types = new Set<string>();
    columns.forEach((col) => {
      if (col.type_category === "enum" || col.enum_values) {
        types.add(col.db_type);
      }
    });
    return Array.from(types);
  }, [columns]);

  // Collect existing column names for validation (includes pending adds)
  const existingColumnNames = useMemo(() => {
    const names = columns.map((col) => col.name);
    // Also include pending column additions
    pendingCommands
      .filter((cmd) => cmd.type === "column.add")
      .forEach((cmd) => {
        const colName = (cmd.payload as ColumnAddPayload).column.name;
        if (colName) names.push(colName);
      });
    return names;
  }, [columns, pendingCommands]);

  // Transform to grid rows (includes pending additions)
  const allGridRows = useMemo(
    () =>
      transformStructureToRows(
        columns,
        foreignKeys,
        constraints,
        pendingCommands,
      ),
    [columns, foreignKeys, constraints, pendingCommands],
  );

  // Filter rows based on search query
  const gridRows = useMemo(() => {
    if (!searchQuery.trim()) return allGridRows;
    const query = searchQuery.toLowerCase();
    return allGridRows.filter((row) =>
      row.column_name.toLowerCase().includes(query),
    );
  }, [allGridRows, searchQuery]);

  // Get selected row indices from GridSelection
  const selectedRowIndices = useMemo(() => {
    if (selection.rows && typeof selection.rows.toArray === "function") {
      return selection.rows.toArray();
    }
    return [];
  }, [selection.rows]);

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: structureColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // Handler: Add new column
  const handleAddColumn = useCallback(() => {
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    const tempId = generateCommandId();
    const command = createColumnAddCommand(
      target,
      {
        name: "",
        dataType: "text",
        nullable: true,
      },
      tempId,
    );

    stageCommand(command);
    toast.success("New column added", {
      description: "Fill in the column details and commit when ready",
    });
  }, [connectionId, database, schema, table, stageCommand]);

  const commitTableName = useCallback(
    (nextNameRaw: string) => {
      const trimmedName = nextNameRaw.trim();

      if (!trimmedName) {
        toast.error("Table name is required");
        setTableNameDraft(pendingTableName ?? table);
        return;
      }

      const validation = validateTableName(trimmedName);
      if (!validation.valid) {
        toast.error("Invalid table name", {
          description: validation.error,
        });
        setTableNameDraft(pendingTableName ?? table);
        return;
      }

      const renameCommands = pendingCommands.filter(
        (cmd) => cmd.type === "table.rename",
      );
      const existingRename = renameCommands[0];
      renameCommands.slice(1).forEach((cmd) => {
        unstageCommand(cmd.id);
      });

      if (existingRename) {
        const payload = existingRename.payload as TableRenamePayload;
        if (trimmedName === table) {
          unstageCommand(existingRename.id);
          setTableNameDraft(table);
          return;
        }
        if (trimmedName === payload.newName) {
          setTableNameDraft(trimmedName);
          return;
        }
        const updatedCmd = {
          ...existingRename,
          payload: {
            ...payload,
            newName: trimmedName,
          },
          metadata: {
            ...existingRename.metadata,
            description: `Rename table ${table} to ${trimmedName}`,
          },
        };
        stageCommand(updatedCmd);
        setTableNameDraft(trimmedName);
        return;
      }

      if (trimmedName === table) {
        setTableNameDraft(trimmedName);
        return;
      }

      const renameCommand = CrudCommandFactory.createTableRenameCommand({
        target: tableRenameTarget,
        newName: trimmedName,
      });
      stageCommand(renameCommand);
      setTableNameDraft(trimmedName);
    },
    [
      pendingCommands,
      pendingTableName,
      stageCommand,
      table,
      tableRenameTarget,
      unstageCommand,
    ],
  );

  const handleTableNameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTableName(event.currentTarget.value);
        event.currentTarget.blur();
      } else if (event.key === "Tab") {
        commitTableName(event.currentTarget.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setTableNameDraft(pendingTableName ?? table);
        event.currentTarget.blur();
      }
    },
    [commitTableName, pendingTableName, table],
  );

  // Handler: Delete column
  const handleDeleteColumn = useCallback(
    (row: StructureGridRow) => {
      if (row._isPending || !!row._tempId || !row._original) {
        // Remove pending add command
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "column.add" &&
            (cmd.payload as ColumnAddPayload).tempId === row._tempId,
        );
        if (command) {
          unstageCommand(command.id);
          toast.success("Pending column removed");
        }
      } else {
        // Stage drop command for existing column
        const target: CrudCommandTarget = {
          connectionId,
          database,
          schema,
          table,
        };
        const command = createColumnDropCommand(target, row.column_name);
        stageCommand(command);
        toast.success("Column deletion staged", {
          description: `${row.column_name} will be dropped when committed`,
        });
      }
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    },
    [
      connectionId,
      database,
      schema,
      table,
      pendingCommands,
      stageCommand,
      unstageCommand,
    ],
  );

  // Handler: Duplicate column
  const handleDuplicateColumn = useCallback(
    (rowIndex: number) => {
      const row = gridRows[rowIndex];
      if (!row) return;

      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      // Generate unique copy name
      const baseName = row.column_name;
      let copyName = `${baseName}_copy`;
      let counter = 2;
      while (existingColumnNames.includes(copyName)) {
        copyName = `${baseName}_copy${counter}`;
        counter++;
      }

      const tempId = generateCommandId();
      const command = createColumnAddCommand(
        target,
        {
          name: copyName,
          dataType: row.db_type || "text",
          nullable: row.nullable === "YES",
          defaultValue: row.default,
          comment: row.comment,
        },
        tempId,
      );

      stageCommand(command);
      toast.success("Column duplicated", {
        description: `Created ${copyName} as a copy of ${row.column_name}`,
      });
    },
    [
      connectionId,
      database,
      schema,
      table,
      gridRows,
      existingColumnNames,
      stageCommand,
    ],
  );

  // Handler: Delete selected rows (batch)
  const handleDeleteSelected = useCallback(() => {
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    let deletedCount = 0;
    for (const rowIndex of selectedRowIndices) {
      const row = gridRows[rowIndex];
      if (!row || row._isPendingDelete) continue;

      if (row._isPending || !!row._tempId || !row._original) {
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "column.add" &&
            (cmd.payload as ColumnAddPayload).tempId === row._tempId,
        );
        if (command) {
          unstageCommand(command.id);
          deletedCount++;
        }
      } else {
        const command = createColumnDropCommand(target, row.column_name);
        stageCommand(command);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      toast.success(
        `${deletedCount} column${
          deletedCount > 1 ? "s" : ""
        } staged for deletion`,
      );
    }
  }, [
    connectionId,
    database,
    schema,
    table,
    selectedRowIndices,
    gridRows,
    pendingCommands,
    stageCommand,
    unstageCommand,
  ]);

  // Handler: Set nullable for selected rows (batch)
  const handleBatchSetNullable = useCallback(
    (value: "YES" | "NO") => {
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      for (const rowIndex of selectedRowIndices) {
        const row = gridRows[rowIndex];
        if (!row || row._isPendingDelete) continue;

        if (row._isPending) {
          const command = pendingCommands.find(
            (cmd) =>
              cmd.type === "column.add" &&
              (cmd.payload as ColumnAddPayload).tempId === row._tempId,
          );
          if (command) {
            const payload = command.payload as ColumnAddPayload;
            const updatedCmd = {
              ...command,
              payload: {
                ...payload,
                column: { ...payload.column, nullable: value === "YES" },
              },
            };
            stageCommand(updatedCmd);
          }
        } else {
          const modifyCmd = createColumnModifyCommand(target, row.column_name, {
            nullable: value === "YES",
          });
          stageCommand(modifyCmd);
        }
      }

      toast.success(
        `Set nullable to ${value} for ${selectedRowIndices.length} column${
          selectedRowIndices.length > 1 ? "s" : ""
        }`,
      );
    },
    [
      connectionId,
      database,
      schema,
      table,
      selectedRowIndices,
      gridRows,
      pendingCommands,
      stageCommand,
    ],
  );

  // Handler: Set type for selected rows (batch)
  const handleBatchSetType = useCallback(
    (dataType: string) => {
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      for (const rowIndex of selectedRowIndices) {
        const row = gridRows[rowIndex];
        if (!row || row._isPendingDelete) continue;

        if (row._isPending) {
          const command = pendingCommands.find(
            (cmd) =>
              cmd.type === "column.add" &&
              (cmd.payload as ColumnAddPayload).tempId === row._tempId,
          );
          if (command) {
            const payload = command.payload as ColumnAddPayload;
            const updatedCmd = {
              ...command,
              payload: {
                ...payload,
                column: { ...payload.column, dataType },
              },
            };
            stageCommand(updatedCmd);
          }
        } else {
          const modifyCmd = createColumnModifyCommand(target, row.column_name, {
            dataType,
          });
          stageCommand(modifyCmd);
        }
      }

      toast.success(
        `Set type to ${dataType} for ${selectedRowIndices.length} column${
          selectedRowIndices.length > 1 ? "s" : ""
        }`,
      );
    },
    [
      connectionId,
      database,
      schema,
      table,
      selectedRowIndices,
      gridRows,
      pendingCommands,
      stageCommand,
    ],
  );

  // Helper to extract value from cell data
  const extractCellValue = useCallback(
    (newValue: EditableGridCell): string | boolean | null => {
      if ("data" in newValue) {
        const data = newValue.data;
        if (typeof data === "object" && data !== null) {
          // Handle column-name-cell with name field
          if (
            "name" in data &&
            (data as { kind?: string }).kind === "column-name-cell"
          ) {
            return (data as { name: string }).name;
          }
          // Handle cell types with value field
          if ("value" in data) {
            return (data as { value: string | boolean | null }).value;
          }
        }
        return data as string | boolean | null;
      }
      return null;
    },
    [],
  );

  // Handler: Cell edited
  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      // Extract value from cell
      const extractedValue = extractCellValue(newValue);

      // Validate column name changes
      if (
        column.field === "column_name" &&
        typeof extractedValue === "string"
      ) {
        const currentColumnName = row._isPending
          ? undefined // New columns don't have an existing name to exclude
          : row._originalData?.name;
        const validation = validateColumnName(
          extractedValue,
          existingColumnNames,
          currentColumnName,
        );
        if (!validation.valid) {
          toast.error("Invalid column name", {
            description: validation.error,
          });
          return;
        }
      }

      if (column.field === "foreign_key") {
        const columnName = row._originalData?.name ?? row.column_name;
        if (!columnName || columnName === "(new column)") {
          toast.error("Set column name before adding a foreign key");
          return;
        }

        const newForeignKeyValue =
          typeof extractedValue === "string" ? extractedValue.trim() : "";
        const existingFk = foreignKeys.find((fk) =>
          fk.columns.includes(columnName),
        );
        const currentRefTable = existingFk
          ? existingFk.foreignSchema
            ? `${existingFk.foreignSchema}.${existingFk.foreignTable}`
            : existingFk.foreignTable
          : "";
        const currentFkValue = existingFk
          ? `${currentRefTable}.${existingFk.foreignColumns[0] ?? ""}`.replace(
              /\.$/,
              "",
            )
          : "";

        const pendingFkAdds = pendingCommands.filter((cmd) => {
          if (cmd.type !== "fk.add") return false;
          const definition = (
            cmd.payload as { definition?: ForeignKeyDefinitionInput }
          ).definition;
          if (!definition?.columns) return false;
          return (
            definition.columns.includes(columnName) ||
            definition.columns.includes(row.column_name)
          );
        });

        const pendingFkDrops = pendingCommands.filter((cmd) => {
          if (cmd.type !== "fk.drop") return false;
          return existingFk
            ? (cmd.payload as { constraintName?: string }).constraintName ===
                existingFk.name
            : false;
        });

        const clearPendingFkAdds = () => {
          pendingFkAdds.forEach((cmd) => {
            unstageCommand(cmd.id);
          });
        };

        const clearPendingFkDrops = () => {
          pendingFkDrops.forEach((cmd) => {
            unstageCommand(cmd.id);
          });
        };

        if (!newForeignKeyValue) {
          clearPendingFkAdds();
          if (existingFk && pendingFkDrops.length === 0) {
            const dropCommand = CrudCommandFactory.createForeignKeyDropCommand({
              target,
              constraintName: existingFk.name,
            });
            stageCommand(dropCommand);
          }
          return;
        }

        const parsed = parseForeignKeyValue(newForeignKeyValue);
        if (!parsed) {
          toast.error("Invalid foreign key format", {
            description: "Use table.column or schema.table.column",
          });
          return;
        }

        const normalizedNewValue = parsed.schema
          ? `${parsed.schema}.${parsed.table}.${parsed.column}`
          : `${parsed.table}.${parsed.column}`;

        if (
          currentFkValue &&
          normalizedNewValue.toLowerCase() === currentFkValue.toLowerCase()
        ) {
          clearPendingFkAdds();
          clearPendingFkDrops();
          return;
        }

        clearPendingFkAdds();

        if (existingFk && pendingFkDrops.length === 0) {
          const dropCommand = CrudCommandFactory.createForeignKeyDropCommand({
            target,
            constraintName: existingFk.name,
          });
          stageCommand(dropCommand);
        }

        const constraintName = buildForeignKeyConstraintName(
          table,
          columnName,
          parsed.table,
          parsed.column,
        );
        const fkDefinition: ForeignKeyDefinitionInput = {
          name: constraintName,
          columns: [columnName],
          referenceTable: parsed.table,
          referenceSchema: parsed.schema,
          referenceColumns: [parsed.column],
        };
        const addCommand = CrudCommandFactory.createForeignKeyAddCommand({
          target,
          definition: fkDefinition,
        });
        stageCommand(addCommand);
        return;
      }

      if (row._isPending) {
        // Update pending column.add command
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "column.add" &&
            (cmd.payload as ColumnAddPayload).tempId === row._tempId,
        );

        if (command) {
          const payload = command.payload as ColumnAddPayload;
          const updatedColumn = { ...payload.column };

          if (column.field === "column_name") {
            updatedColumn.name = String(extractedValue ?? "");
          } else if (column.field === "db_type") {
            updatedColumn.dataType = String(extractedValue ?? "text");
          } else if (column.field === "nullable") {
            updatedColumn.nullable = extractedValue === "YES";
          } else if (column.field === "default") {
            updatedColumn.defaultValue = extractedValue;
          } else if (column.field === "check_constraint") {
            updatedColumn.checkExpression = String(extractedValue ?? "");
          } else if (column.field === "comment") {
            updatedColumn.comment = String(extractedValue ?? "");
          }

          const updatedCmd = {
            ...command,
            payload: {
              ...payload,
              column: updatedColumn,
            },
          };

          stageCommand(updatedCmd);
        }
      } else {
        // Modify existing column
        const baseColumnName = row._originalData?.name ?? row.column_name;

        if (column.field === "column_name") {
          const newName = String(extractedValue ?? "");
          if (!newName || newName === row.column_name) {
            return;
          }

          const renameCommands = pendingCommands.filter((cmd) => {
            if (cmd.type !== "column.rename") return false;
            const payload = cmd.payload as { columnName?: string };
            return payload.columnName === baseColumnName;
          });

          const existingRename = renameCommands[0];
          if (existingRename) {
            renameCommands.slice(1).forEach((cmd) => {
              unstageCommand(cmd.id);
            });
            const payload = existingRename.payload as {
              columnName: string;
              newName: string;
            };
            if (newName === payload.columnName) {
              unstageCommand(existingRename.id);
              return;
            }
            if (newName === payload.newName) {
              return;
            }
            const updatedCmd = {
              ...existingRename,
              payload: {
                ...payload,
                newName,
              },
              metadata: {
                ...existingRename.metadata,
                description: `Rename column ${payload.columnName} to ${newName}`,
              },
            };
            stageCommand(updatedCmd);
            return;
          }

          if (newName && newName !== baseColumnName) {
            const renameCmd = createColumnRenameCommand(
              target,
              baseColumnName,
              newName,
            );
            stageCommand(renameCmd);
          }
          return;
        }

        // Other field changes - use/merge modify command
        const newDefinition: Record<string, unknown> = {};

        if (column.field === "nullable") {
          newDefinition.nullable = extractedValue === "YES";
          logger.info("[TableStructure] Nullable change:", {
            extractedValue,
            nullable: newDefinition.nullable,
          });
        } else if (column.field === "default") {
          newDefinition.defaultValue = extractedValue;
        } else if (column.field === "check_constraint") {
          newDefinition.checkExpression = String(extractedValue ?? "");
        } else if (column.field === "comment") {
          // For comment changes, include the full column definition
          // This is especially important for MySQL which requires MODIFY COLUMN with full definition
          const originalData = row._originalData;
          if (originalData) {
            newDefinition.name = originalData.name;
            newDefinition.dataType = originalData.db_type;
            newDefinition.nullable = originalData.nullable;
            if (originalData.default !== undefined && originalData.default !== null) {
              newDefinition.defaultValue = originalData.default;
            }
          }
          newDefinition.comment = extractedValue;
        } else if (column.field === "db_type") {
          newDefinition.dataType = extractedValue;
        }

        const modifyCommands = pendingCommands.filter((cmd) => {
          if (cmd.type !== "column.modify") return false;
          const payload = cmd.payload as { columnName?: string };
          return payload.columnName === baseColumnName;
        });

        const existingModify = modifyCommands[0];
        if (existingModify) {
          modifyCommands.slice(1).forEach((cmd) => {
            unstageCommand(cmd.id);
          });
          const payload = existingModify.payload as {
            columnName: string;
            newDefinition: Record<string, unknown>;
          };
          const mergedDefinition = {
            ...payload.newDefinition,
            ...newDefinition,
          };
          const updatedCmd = {
            ...existingModify,
            payload: {
              ...payload,
              newDefinition: mergedDefinition,
            },
            metadata: {
              ...existingModify.metadata,
              description: existingModify.metadata.description,
            },
          };
          stageCommand(updatedCmd);
          return;
        }

        logger.info("[TableStructure] Creating modify command:", {
          columnName: baseColumnName,
          newDefinition,
        });
        const modifyCmd = createColumnModifyCommand(
          target,
          baseColumnName,
          newDefinition,
        );
        logger.info("[TableStructure] Modify command created:", modifyCmd);
        stageCommand(modifyCmd);
      }
    },
    [
      sizedColumns,
      gridRows,
      connectionId,
      database,
      schema,
      table,
      pendingCommands,
      stageCommand,
      unstageCommand,
      foreignKeys,
      extractCellValue,
      existingColumnNames,
    ],
  );

  // Cell content factory
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

      const fieldValue = row[column.field as keyof StructureGridRow];
      const isPending = row._isPending ?? false;
      const isModified = row._isModified ?? false;
      const isPendingDelete = row._isPendingDelete ?? false;

      // Row background - match TableDataGrid colors with priority order
      const rowTheme = isPendingDelete
        ? {
            bgCell: "rgba(239, 68, 68, 0.06)", // red-500 for pending delete
            bgCellMedium: "rgba(239, 68, 68, 0.08)",
            accentColor: "rgba(239, 68, 68, 0.4)",
            accentLight: "rgba(239, 68, 68, 0.15)",
            textDark: "#dc2626", // red text
          }
        : isPending
        ? {
            bgCell: "rgba(34, 197, 94, 0.06)", // green-500 for new columns
            bgCellMedium: "rgba(34, 197, 94, 0.08)",
            accentColor: "rgba(34, 197, 94, 0.4)",
            accentLight: "rgba(34, 197, 94, 0.15)",
          }
        : isModified
        ? {
            bgCell: "rgba(212, 165, 43, 0.04)", // brand golden for modified columns
            bgCellMedium: "rgba(212, 165, 43, 0.06)",
            accentColor: "#D4A52B",
            accentLight: "rgba(212, 165, 43, 0.12)",
          }
        : undefined;

      const originalColumnName = row._originalData?.name ?? row.column_name;
      const modifiedFields = originalColumnName
        ? modifiedFieldsByColumn.get(originalColumnName)
        : undefined;
      const isCellModified =
        !isPendingDelete &&
        !isPending &&
        Boolean(
          modifiedFields?.has(column.field as StructureModifiedField),
        );

      const cellThemeOverride = isCellModified
        ? {
            ...(rowTheme ?? {}),
            bgCell: "rgba(251, 146, 60, 0.15)", // orange highlight
            accentColor: "#fb923c",
            accentLight: "rgba(251, 146, 60, 0.2)",
          }
        : rowTheme;

      // Actions column - Delete/Undo button with custom icon renderer
      if (column.field === "actions") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "actions-cell",
            isPendingDelete,
          },
          copyData: isPendingDelete ? "undo" : "delete",
          readonly: true,
          allowOverlay: false,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Make all cells readonly when row is pending delete
      if (isPendingDelete) {
        const displayValue =
          typeof fieldValue === "object"
            ? JSON.stringify(fieldValue)
            : String(fieldValue ?? "");
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Column name - editable custom cell with PK/FK indicators
      if (column.field === "column_name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "column-name-cell",
            name: row.column_name || "",
            isPrimaryKey:
              row.column_meta?.is_pk ?? row._original?.is_pk ?? false,
            isForeignKey: row.column_meta?.is_fk ?? Boolean(row.foreign_key),
          },
          copyData: row.column_name || "",
          readonly: false,
          allowOverlay: true,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Row number (right-aligned, muted)
      if (column.field === "row_number") {
        const rowNum = typeof fieldValue === "number" ? fieldValue : 0;
        return {
          kind: GridCellKind.Text,
          data: String(rowNum),
          displayData: String(rowNum),
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Nullable - YES/NO dropdown
      if (column.field === "nullable") {
        const nullableValue = (
          typeof fieldValue === "string" ? fieldValue : "NO"
        ) as "YES" | "NO";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "nullable-cell",
            value: nullableValue,
            columnName: row.column_name,
          },
          copyData: nullableValue,
          readonly: false,
          allowOverlay: true,
          contentAlign: "center" as const,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Type - data type dropdown - editable for all rows
      if (column.field === "db_type") {
        const typeValue = typeof fieldValue === "string" ? fieldValue : "text";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "datatype-cell",
            value: typeValue,
            customTypes: customTypes,
            columnName: row.column_name,
          },
          copyData: typeValue,
          readonly: false, // Allow editing for all rows
          allowOverlay: true,
          themeOverride: cellThemeOverride,
        } as const;
      }

      if (column.field === "default") {
        const value = typeof fieldValue === "string" ? fieldValue : null;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "default-value-cell",
            value,
            columnName: row.column_name,
            dbType: row.db_type,
          },
          copyData: value ?? "NULL",
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      if (column.field === "comment") {
        const value = typeof fieldValue === "string" ? fieldValue : null;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "comment-cell",
            value,
            columnName: row.column_name,
          },
          copyData: value ?? "",
          readonly: false,
          allowOverlay: true,
          themeOverride: cellThemeOverride,
        } as const;
      }

      if (column.field === "foreign_key") {
        const value = typeof fieldValue === "string" ? fieldValue : "";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "foreign-key-cell",
            value,
            suggestions: foreignKeyTargets,
            columnName: row.column_name,
          },
          copyData: value,
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      if (column.field === "check_constraint") {
        const value = typeof fieldValue === "string" ? fieldValue : "";
        const normalizedValue = normalizeCheckConstraint(value);
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "check-constraint-cell",
            value: normalizedValue,
            columnName: row.column_name,
          },
          copyData: normalizedValue,
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // is_computed column - readonly YES/NO display
      if (column.field === "is_computed") {
        const isComputedValue = (
          typeof fieldValue === "string" ? fieldValue : "NO"
        ) as "YES" | "NO";
        const baseTheme = cellThemeOverride ?? {};
        return {
          kind: GridCellKind.Text,
          data: isComputedValue,
          displayData: isComputedValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "center" as const,
          themeOverride: {
            ...baseTheme,
            ...(isComputedValue === "YES" && { textDark: "#f97316" }),
          },
        } as const;
      }

      // MySQL/MariaDB specific columns - readonly text with truncation
      if (column.field === "character_set" || column.field === "collation" || column.field === "extra") {
        const displayValue = typeof fieldValue === "string" ? fieldValue : "";
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: true, // Allow viewing full content
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px",
          },
        } as const;
      }

      // Default text cell
      const displayValue = typeof fieldValue === "string" ? fieldValue : "";
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: false,
        themeOverride: cellThemeOverride,
      } as const;
    },
    [
      gridRows,
      sizedColumns,
      customTypes,
      foreignKeyTargets,
      modifiedFieldsByColumn,
    ],
  );

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      ColumnNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      DefaultValueCellRenderer as unknown as CustomRenderer<AnyCell>,
      ForeignKeyCellRenderer as unknown as CustomRenderer<AnyCell>,
      CheckConstraintCellRenderer as unknown as CustomRenderer<AnyCell>,
      CommentCellRenderer as unknown as CustomRenderer<AnyCell>,
      NullableCellRenderer as unknown as CustomRenderer<AnyCell>,
      DataTypeCellRenderer as unknown as CustomRenderer<AnyCell>,
      ActionsCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  const handleCellClick = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Handle action button click
      if (column.field === "actions") {
        if (row._isPendingDelete) {
          // Undo pending delete - find and unstage the drop command
          const dropCommand = pendingCommands.find(
            (cmd) =>
              cmd.type === "column.drop" &&
              (cmd.payload as ColumnDropPayload).columnName ===
                row._original?.name,
          );
          if (dropCommand) {
            unstageCommand(dropCommand.id);
            toast.success("Delete undone", {
              description: `${row._original?.name} will no longer be dropped`,
            });
          }
        } else if (row._isPending || !!row._tempId || !row._original) {
          logger.info("[TableStructure] Deleting pending column:", {
            row,
            isPending: row._isPending,
            tempId: row._tempId,
            hasOriginal: !!row._original,
          });
          // If it's a pending column (newly added), delete immediately without confirmation
          handleDeleteColumn(row);
        } else {
          logger.info("[TableStructure] Showing delete dialog for existing column:", {
            row,
            isPending: row._isPending,
            tempId: row._tempId,
            hasOriginal: !!row._original,
          });
          // Show delete confirmation
          setDeleteTarget(row);
          setDeleteDialogOpen(true);
        }
      }
    },
    [sizedColumns, gridRows, pendingCommands, unstageCommand, handleDeleteColumn],
  );

  // Handler: Cell activated (double-click to enter edit mode)
  const handleCellActivated = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Don't activate for readonly cells
      if (row._isPendingDelete) return;

      logger.info("[TableStructure] Cell activated for editing:", {
        cell,
        column: column.field,
        row: row.column_name,
      });
    },
    [sizedColumns, gridRows],
  );

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never intercept keys while command palette is open
      if (contextService.getValue("inQuickOpen")) return;

      // Don't intercept keys when focus is on a text input
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Cmd+D / Ctrl+D - Duplicate selected column
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        const firstSelected = selectedRowIndices[0];
        if (selectedRowIndices.length === 1 && firstSelected !== undefined) {
          handleDuplicateColumn(firstSelected);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedRowIndices, handleDuplicateColumn]);

  if (isLoading) {
    return <TableStructureSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (columns.length === 0 && pendingCommands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-xs">No columns available for this object.</p>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Combined toolbar: table name + actions + search */}
        <div className="flex items-center gap-2 px-0 pb-1.5 pt-0.5 bg-transparent">
          <Input
            id="tableName"
            value={tableNameDraft}
            onChange={(e) => {
              if (!isReadOnly) {
                setTableNameDraft(e.target.value);
              }
            }}
            onBlur={() => {
              if (!isReadOnly) {
                commitTableName(tableNameDraft);
              }
            }}
            onKeyDown={isReadOnly ? undefined : handleTableNameKeyDown}
            className="h-7 w-48 text-xs font-medium"
            placeholder="Table name"
            readOnly={isReadOnly}
          />

          {!isReadOnly && (
            <TableActionsToolbar
              addButtonLabel="Add Column"
              onAdd={handleAddColumn}
              onReviewChanges={() => {
                setGlobalChangesDialogOpen(true);
              }}
              onDiscard={() => {
                discardChanges(tableKey);
                setTableNameDraft(table);
                toast.success("Changes discarded");
              }}
              pendingChangesCount={pendingCommands.length}
              batchActions={
                <BatchActionsToolbar
                  selectedCount={selectedRowIndices.length}
                  onDeleteSelected={handleDeleteSelected}
                  onSetNullable={handleBatchSetNullable}
                  onSetType={handleBatchSetType}
                />
              }
              inline
            />
          )}

          <div className="flex-1" />

          {/* Search input */}
          <div className="relative">
            <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                handleSearchChange(e.target.value);
              }}
              placeholder="Filter columns..."
              className="h-7 w-40 pl-7 text-xs"
            />
          </div>
        </div>
        <div className="flex-1">
          <DataGridBase
            columns={sizedColumns}
            rowCount={gridRows.length}
            getCellContent={getCellContent}
            customRenderers={customRenderers}
            rowSelect="multi"
            columnSelect="none"
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            onColumnResize={handleColumnResize}
            onColumnResizeEnd={handleColumnResizeEnd}
            onCellActivated={isReadOnly ? undefined : handleCellActivated}
            onCellEdited={isReadOnly ? undefined : handleCellEdited}
            onCellClicked={isReadOnly ? undefined : handleCellClick}
            overscrollX={0}
            overscrollY={300}
            trailingRowOptions={
              isReadOnly
                ? undefined
                : {
                    sticky: false,
                    tint: false,
                  }
            }
            onRowAppended={isReadOnly ? undefined : handleAddColumn}
          />
        </div>
        <div className="px-4 py-2 text-xs text-muted-foreground border-t">
          Last refreshed:{" "}
          {(structure as any)?.fetchedAt
            ? new Date(
                (structure as any).fetchedAt as string | number | Date,
              ).toLocaleString()
            : "n/a"}
          <button
            type="button"
            onClick={() => refresh().catch(() => undefined)}
            className="ml-4 text-primary hover:underline"
          >
            Refresh
          </button>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Column"
        description="Are you sure you want to delete this column? This action cannot be undone and all data in this column will be permanently lost."
        entityName={deleteTarget?.column_name}
        onConfirm={() => {
          if (deleteTarget) {
            handleDeleteColumn(deleteTarget);
          }
        }}
      />

      <GlobalChangesDialog
        open={globalChangesDialogOpen}
        onOpenChange={setGlobalChangesDialogOpen}
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        onCommitSuccess={() => {
          if (
            pendingTableName &&
            pendingTableName !== table &&
            panelId &&
            tabId
          ) {
            updateTabMetadata(panelId, tabId, {
              title: pendingTableName,
              table: pendingTableName,
            });
            return;
          }
          refresh().catch(() => undefined);
        }}
      />
    </>
  );
});

const TableStructureSkeleton = memo(function TableStructureSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
});

export default TableStructure;
