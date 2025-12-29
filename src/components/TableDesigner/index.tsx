import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { ColumnNameCellRenderer } from "@/components/TableStructure/ColumnNameCellRenderer";
import { NullableCellRenderer } from "@/components/TableStructure/NullableCellRenderer";
import { DataTypeCellRenderer } from "@/components/TableStructure/DataTypeCellRenderer";
import { DefaultValueCellRenderer } from "@/components/TableStructure/DefaultValueCellRenderer";
import { ForeignKeyCellRenderer } from "@/components/TableStructure/ForeignKeyCellRenderer";
import { CheckConstraintCellRenderer } from "@/components/TableStructure/CheckConstraintCellRenderer";
import { CommentCellRenderer } from "@/components/TableStructure/CommentCellRenderer";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import { createTableCreateCommand } from "./commandFactory";
import type { CrudCommandTarget } from "@/types/crud";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { useForeignKeyTargets } from "@/hooks/useForeignKeyTargets";
import { CrudCommandFactory } from "@/services/crudCommandFactory";

export interface TableDesignerProps {
  connectionId: string;
  database: string;
  schema?: string;
  className?: string;
  onSave?: (tableName: string, sql: string) => void;
  onCancel?: () => void;
}

// Local column state (not in crudStore until submit)
interface DesignerColumn {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
  foreignKey: string;
  checkConstraint: string;
  comment: string;
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
  foreign_key: string;
  check_constraint: string;
  comment: string;
  _tempId: string;
}

function createDefaultColumn(): DesignerColumn {
  return {
    id: nanoid(),
    name: "",
    dataType: "VARCHAR(255)",
    nullable: true,
    defaultValue: "",
    isPrimaryKey: false,
    foreignKey: "",
    checkConstraint: "",
    comment: "",
  };
}

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
  const parts = rawValue.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const column = parts.pop();
  const table = parts.pop();
  if (!column || !table) return null;
  const schema = parts.length ? parts.join(".") : undefined;
  return { schema, table, column };
};

const quoteIdentifier = (value: string): string =>
  `"${value.replace(/"/g, '""')}"`;

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
  connectionId,
  database,
  schema = "public",
  className,
  onSave,
  onCancel,
}) => {
  const [tableName, setTableName] = useState("");
  const tableNameInputRef = useRef<HTMLInputElement>(null);
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);

  // Local column state (not in crudStore until submit)
  const [columns, setColumns] = useState<DesignerColumn[]>(() => [
    {
      id: nanoid(),
      name: "id",
      dataType: "SERIAL",
      nullable: false,
      defaultValue: "",
      isPrimaryKey: true,
      foreignKey: "",
      checkConstraint: "",
      comment: "",
    },
  ]);

  const { stageCommand, discardChanges } = useCrudStore();
  const { targets: foreignKeyTargets } = useForeignKeyTargets({
    connectionId,
    database,
    schema,
  });

  // Table key for crudStore - uses actual table name when available
  const tableKey = useMemo(
    () =>
      buildCrudTableKey({
        connectionId,
        database,
        schema,
        table: tableName.trim() || "__new_table_design",
      }),
    [connectionId, database, schema, tableName],
  );

  // Auto-focus on table name input
  useEffect(() => {
    tableNameInputRef.current?.focus();
  }, []);

  // Transform local columns to grid rows
  const gridRows = useMemo((): DesignerGridRow[] => {
    return columns.map((col, index) => ({
      row_number: index + 1,
      column_name: col.name || "",
      column_meta: {
        is_pk: col.isPrimaryKey || col.dataType.toUpperCase().includes("SERIAL"),
        is_fk: Boolean(col.foreignKey),
      },
      db_type: col.dataType || "VARCHAR(255)",
      nullable: col.nullable ? "YES" : "NO",
      default: col.defaultValue || "",
      foreign_key: col.foreignKey || "",
      check_constraint: col.checkConstraint || "",
      comment: col.comment || "",
      _tempId: col.id,
    }));
  }, [columns]);

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
          };

        case "db_type":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "datatype-cell",
              value: rowData.db_type,
            },
            copyData: rowData.db_type,
            allowOverlay: true,
          };

        case "nullable":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "nullable-cell",
              value: rowData.nullable,
            },
            copyData: rowData.nullable,
            allowOverlay: true,
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
    [gridRows, sizedColumns],
  );

  // Handle cell edit
  const handleCellEdited = useCallback(
    ([col, row]: Item, newValue: GridCell) => {
      const rowData = gridRows[row];
      if (!rowData) return;

      const column = sizedColumns[col];
      const field = column?.field;
      const columnId = rowData._tempId;

      setColumns((prev) =>
        prev.map((c) => {
          if (c.id !== columnId) return c;

          const updated = { ...c };

          switch (field) {
            case "column_name":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { name?: string; value?: string };
                updated.name = data.name || data.value || "";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.name = newValue.data || "";
              }
              break;

            case "db_type":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string };
                updated.dataType = data.value || "VARCHAR(255)";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.dataType = newValue.data || "VARCHAR(255)";
              }
              // Update isPrimaryKey based on SERIAL type
              updated.isPrimaryKey = updated.dataType.toUpperCase().includes("SERIAL");
              break;

            case "nullable":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string };
                updated.nullable = data.value === "YES";
              }
              break;

            case "default":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string | null };
                updated.defaultValue = data.value ?? "";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.defaultValue = newValue.data || "";
              }
              break;

            case "foreign_key":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string };
                updated.foreignKey = data.value || "";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.foreignKey = newValue.data || "";
              }
              break;

            case "check_constraint":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string | null };
                updated.checkConstraint = data.value ?? "";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.checkConstraint = newValue.data || "";
              }
              break;

            case "comment":
              if (newValue.kind === GridCellKind.Custom) {
                const data = newValue.data as { value?: string | null };
                updated.comment = data.value ?? "";
              } else if (newValue.kind === GridCellKind.Text) {
                updated.comment = newValue.data || "";
              }
              break;
          }

          return updated;
        }),
      );
    },
    [gridRows, sizedColumns],
  );

  // Handle row append
  const handleRowAppended = useCallback(() => {
    setColumns((prev) => [...prev, createDefaultColumn()]);
  }, []);

  // Generate SQL
  const generateSQL = useCallback(() => {
    if (!tableName.trim() || gridRows.length === 0) return "";

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
        ? `,\n  PRIMARY KEY (${pkColumns.map((c) => quoteIdentifier(c)).join(", ")})`
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
      .map((constraint) => (constraint.startsWith(",") ? constraint : `,\n${constraint}`))
      .join("");

    const createTable = `CREATE TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(
      tableName,
    )} (\n${columnDefs}${allConstraints}\n);`;

    const commentStatements = gridRows
      .map((col) => {
        if (!col.comment || !col.comment.trim()) return null;
        const columnRef = `${quoteIdentifier(schema)}.${quoteIdentifier(
          tableName,
        )}.${quoteIdentifier(col.column_name)}`;
        const escaped = col.comment.replace(/'/g, "''");
        return `COMMENT ON COLUMN ${columnRef} IS '${escaped}';`;
      })
      .filter((statement): statement is string => Boolean(statement));

    return [createTable, ...commentStatements].join("\n");
  }, [tableName, gridRows, schema]);

  const handleSave = useCallback(() => {
    if (!tableName.trim()) {
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

    // Create command target
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table: tableName,
    };

    // Convert local columns to ColumnDefinitionInput format
    const columnDefs = columns.map((col) => ({
      name: col.name,
      dataType: col.dataType,
      nullable: col.nullable,
      defaultValue: col.defaultValue || undefined,
      isPrimaryKey: col.isPrimaryKey,
      checkExpression: col.checkConstraint?.trim() || undefined,
      comment: col.comment?.trim() || undefined,
    }));

    // Extract primary key columns
    const primaryKey = columns
      .filter((col) => col.isPrimaryKey)
      .map((col) => col.name);

    // Create and stage the table.create command
    const command = createTableCreateCommand(target, {
      tableName,
      columns: columnDefs,
      primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
    });

    const invalidForeignKeys = new Set<string>();
    const foreignKeyDefinitions: Array<{
      name: string;
      columns: string[];
      referenceTable: string;
      referenceSchema?: string;
      referenceColumns: string[];
    }> = [];

    columns.forEach((col) => {
      const rawValue = col.foreignKey?.trim();
      if (!rawValue) return;
      const parsed = parseForeignKeyValue(rawValue);
      if (!parsed) {
        invalidForeignKeys.add(rawValue);
        return;
      }
      const constraintName = buildForeignKeyConstraintName(
        tableName,
        col.name,
        parsed.table,
        parsed.column,
      );
      foreignKeyDefinitions.push({
        name: constraintName,
        columns: [col.name],
        referenceTable: parsed.table,
        referenceSchema: parsed.schema,
        referenceColumns: [parsed.column],
      });
    });

    if (invalidForeignKeys.size > 0) {
      toast.error("Invalid foreign key format", {
        description: "Use table.column or schema.table.column",
      });
      return;
    }

    stageCommand(command);
    foreignKeyDefinitions.forEach((definition) => {
      stageCommand(
        CrudCommandFactory.createForeignKeyAddCommand({
          target,
          definition,
        }),
      );
    });
    setGlobalChangesDialogOpen(true);
  }, [tableName, columns, connectionId, database, schema, stageCommand]);

  const handleCancel = useCallback(() => {
    discardChanges(tableKey);
    onCancel?.();
  }, [discardChanges, tableKey, onCancel]);

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
              onChange={(e) => { setTableName(e.target.value); }}
              placeholder="Enter table name"
              className="mt-1"
            />
          </div>
          <div className="flex-none">
            <Label className="text-xs text-muted-foreground">Schema</Label>
            <div className="mt-1 px-3 py-2 text-xs bg-muted rounded-md">
              {schema}
            </div>
          </div>
        </div>
      </div>

      {/* Columns Editor */}
      <div className="flex-1 min-h-0">
        <DataGridBase
          columns={sizedColumns}
          rowCount={gridRows.length}
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
          rowSelect="none"
          columnSelect="none"
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
          disabled={!tableName.trim() || columns.length === 0}
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
        table={tableName}
        onCommitSuccess={() => {
          const sql = generateSQL();
          onSave?.(tableName, sql);
          discardChanges(tableKey);
          setGlobalChangesDialogOpen(false);
        }}
      />
    </div>
  );
};

export default TableDesigner;
