import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { DataGridBase } from "@/components/DataGridV2/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGridV2/hooks/useColumnSizing";
import type { GridColumnV2 } from "@/components/DataGridV2/types";
import { NullableCellRenderer } from "@/components/TableStructure/NullableCellRenderer";
import { DataTypeCellRenderer } from "@/components/TableStructure/DataTypeCellRenderer";
import ColumnNameCellRenderer from "@/components/TableStructure/ColumnNameCellRenderer";
import { TextSingleLineCellRenderer } from "@/components/DataGridV2/renderers/TextCell";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import {
  createColumnAddCommand,
  createColumnModifyCommand,
  generateCommandId,
} from "@/components/TableStructure/commandFactory";
import type { CrudCommandTarget } from "@/types/crud";
import { toast } from "sonner";

export interface TableDesignerProps {
  connectionId: string;
  database: string;
  schema?: string;
  className?: string;
  onSave?: (tableName: string, sql: string) => void;
  onCancel?: () => void;
}

// Grid row for designer
interface DesignerGridRow {
  row_number: number;
  column_name: string;
  column_meta: {
    is_pk: boolean;
    is_fk: boolean;
  };
  db_type: string;
  nullable: string;
  default: string;
  _tempId: string;
}

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
];

type AnyCell = CustomCell<Record<string, unknown>>;

export const TableDesigner: React.FC<TableDesignerProps> = ({
  connectionId,
  database,
  schema = "public",
  className,
  onSave,
  onCancel,
}) => {
  const [tableName, setTableName] = useState("");
  const tableNameInputRef = useRef<HTMLInputElement>(null);

  const { stagedCommands, stageCommand, unstageCommand, clearTableCommands } =
    useCrudStore();

  // Use a temporary table key for the new table design
  const tableKey = useMemo(
    () =>
      buildCrudTableKey({
        connectionId,
        database,
        schema,
        table: `__new_table_${Date.now()}`,
      }),
    [connectionId, database, schema]
  );

  // Get pending commands for this design session
  const pendingCommands = useMemo(() => {
    return stagedCommands.get(tableKey) ?? [];
  }, [stagedCommands, tableKey]);

  // Auto-focus on table name input
  useEffect(() => {
    tableNameInputRef.current?.focus();
  }, []);

  // Initialize with one default column
  useEffect(() => {
    if (pendingCommands.length === 0) {
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table: tableKey,
      };

      const tempId = generateCommandId();
      const command = createColumnAddCommand(
        target,
        {
          name: "id",
          dataType: "SERIAL",
          nullable: false,
        },
        tempId
      );
      stageCommand(command);
    }
  }, [connectionId, database, schema, tableKey, pendingCommands.length, stageCommand]);

  // Transform commands to grid rows
  const gridRows = useMemo((): DesignerGridRow[] => {
    return pendingCommands
      .filter((cmd) => cmd.operation === "column_add")
      .map((cmd, index) => {
        const payload = cmd.payload as {
          name: string;
          dataType: string;
          nullable: boolean;
          defaultValue?: string;
        };
        return {
          row_number: index + 1,
          column_name: payload.name || "",
          column_meta: {
            is_pk: payload.dataType?.toUpperCase().includes("SERIAL") || false,
            is_fk: false,
          },
          db_type: payload.dataType || "VARCHAR(255)",
          nullable: payload.nullable ? "YES" : "NO",
          default: payload.defaultValue || "",
          _tempId: cmd.id,
        };
      });
  }, [pendingCommands]);

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
      ColumnNameCellRenderer as unknown as CustomRenderer<CustomCell>,
      NullableCellRenderer as unknown as CustomRenderer<CustomCell>,
      DataTypeCellRenderer as unknown as CustomRenderer<CustomCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<CustomCell>,
    ],
    []
  );

  // Get cell content
  const getCellContent = useCallback(
    ([col, row]: Item): AnyCell => {
      const rowData = gridRows[row];
      if (!rowData) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
        } as AnyCell;
      }

      const column = sizedColumns[col];
      const field = column?.field;

      switch (field) {
        case "row_number":
          return {
            kind: GridCellKind.Number,
            data: rowData.row_number,
            displayData: String(rowData.row_number),
            allowOverlay: false,
            readonly: true,
          } as AnyCell;

        case "column_name":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "column-name-cell",
              name: rowData.column_name,
              isPrimaryKey: rowData.column_meta.is_pk,
              isForeignKey: rowData.column_meta.is_fk,
            },
            copyData: rowData.column_name,
            allowOverlay: true,
          } as AnyCell;

        case "db_type":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "data-type-cell",
              value: rowData.db_type,
            },
            copyData: rowData.db_type,
            allowOverlay: true,
          } as AnyCell;

        case "nullable":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "nullable-cell",
              value: rowData.nullable,
            },
            copyData: rowData.nullable,
            allowOverlay: true,
          } as AnyCell;

        case "default":
          return {
            kind: GridCellKind.Text,
            data: rowData.default,
            displayData: rowData.default,
            allowOverlay: true,
          } as AnyCell;

        default:
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
            allowOverlay: false,
          } as AnyCell;
      }
    },
    [gridRows, sizedColumns]
  );

  // Handle cell edit
  const handleCellEdited = useCallback(
    ([col, row]: Item, newValue: AnyCell) => {
      const rowData = gridRows[row];
      if (!rowData) return;

      const column = sizedColumns[col];
      const field = column?.field;
      const tempId = rowData._tempId;

      // Find the existing command
      const existingCmd = pendingCommands.find((cmd) => cmd.id === tempId);
      if (!existingCmd) return;

      const payload = existingCmd.payload as {
        name: string;
        dataType: string;
        nullable: boolean;
        defaultValue?: string;
      };

      let updatedPayload = { ...payload };

      switch (field) {
        case "column_name":
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { name?: string };
            updatedPayload.name = data.name || "";
          } else if (newValue.kind === GridCellKind.Text) {
            updatedPayload.name = newValue.data || "";
          }
          break;

        case "db_type":
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string };
            updatedPayload.dataType = data.value || "VARCHAR(255)";
          } else if (newValue.kind === GridCellKind.Text) {
            updatedPayload.dataType = newValue.data || "VARCHAR(255)";
          }
          break;

        case "nullable":
          if (newValue.kind === GridCellKind.Custom) {
            const data = newValue.data as { value?: string };
            updatedPayload.nullable = data.value === "YES";
          }
          break;

        case "default":
          if (newValue.kind === GridCellKind.Text) {
            updatedPayload.defaultValue = newValue.data || "";
          }
          break;
      }

      // Update the command
      unstageCommand(tempId);
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table: tableKey,
      };
      const newCommand = createColumnAddCommand(target, updatedPayload, tempId);
      stageCommand(newCommand);
    },
    [
      gridRows,
      sizedColumns,
      pendingCommands,
      unstageCommand,
      stageCommand,
      connectionId,
      database,
      schema,
      tableKey,
    ]
  );

  // Handle row append
  const handleRowAppended = useCallback(() => {
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table: tableKey,
    };

    const tempId = generateCommandId();
    const command = createColumnAddCommand(
      target,
      {
        name: "",
        dataType: "VARCHAR(255)",
        nullable: true,
      },
      tempId
    );
    stageCommand(command);
  }, [connectionId, database, schema, tableKey, stageCommand]);

  // Generate SQL
  const generateSQL = useCallback(() => {
    if (!tableName.trim() || gridRows.length === 0) return "";

    const pkColumns = gridRows
      .filter((r) => r.column_meta.is_pk)
      .map((r) => r.column_name);

    const columnDefs = gridRows
      .map((col) => {
        let def = `  "${col.column_name}" ${col.db_type}`;
        if (col.nullable === "NO") def += " NOT NULL";
        if (col.default) def += ` DEFAULT ${col.default}`;
        return def;
      })
      .join(",\n");

    const pkConstraint =
      pkColumns.length > 0
        ? `,\n  PRIMARY KEY (${pkColumns.map((c) => `"${c}"`).join(", ")})`
        : "";

    return `CREATE TABLE "${schema}"."${tableName}" (\n${columnDefs}${pkConstraint}\n);`;
  }, [tableName, gridRows, schema]);

  const handleSave = useCallback(() => {
    if (!tableName.trim()) {
      toast.error("Please enter a table name");
      tableNameInputRef.current?.focus();
      return;
    }
    if (gridRows.length === 0) {
      toast.error("Please add at least one column");
      return;
    }

    const sql = generateSQL();
    onSave?.(tableName, sql);

    // Clear the staged commands after save
    clearTableCommands(tableKey);
  }, [tableName, gridRows, generateSQL, onSave, clearTableCommands, tableKey]);

  const handleCancel = useCallback(() => {
    clearTableCommands(tableKey);
    onCancel?.();
  }, [clearTableCommands, tableKey, onCancel]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-none p-4 border-b space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label
              htmlFor="tableName"
              className="text-xs text-muted-foreground"
            >
              Table Name
            </Label>
            <Input
              ref={tableNameInputRef}
              id="tableName"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="Enter table name"
              className="mt-1"
            />
          </div>
          <div className="flex-none">
            <Label className="text-xs text-muted-foreground">Schema</Label>
            <div className="mt-1 px-3 py-2 text-sm bg-muted rounded-md">
              {schema}
            </div>
          </div>
        </div>
      </div>

      {/* Columns Editor */}
      <div className="flex-1 min-h-0">
        <DataGridBase
          columns={sizedColumns}
          rows={gridRows.length}
          getCellContent={getCellContent}
          onCellEdited={handleCellEdited}
          customRenderers={customRenderers}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
          rowMarkers="clickable-number"
          trailingRowOptions={{
            hint: "Add column...",
            sticky: true,
            tint: true,
          }}
          onRowAppended={handleRowAppended}
          smoothScrollX
          smoothScrollY
        />
      </div>

      {/* SQL Preview */}
      <div className="flex-none border-t">
        <div className="p-2 text-xs text-muted-foreground font-medium">
          SQL Preview
        </div>
        <ScrollArea className="max-h-32">
          <pre className="px-3 pb-3 text-xs font-mono bg-muted/50 overflow-x-auto">
            {generateSQL() || "-- Enter table name and columns to preview SQL"}
          </pre>
        </ScrollArea>
      </div>

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
          disabled={!tableName.trim() || gridRows.length === 0}
        >
          Create Table
        </Button>
      </div>
    </div>
  );
};

export default TableDesigner;
