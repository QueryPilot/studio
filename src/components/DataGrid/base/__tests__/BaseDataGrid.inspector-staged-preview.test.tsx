import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import { BaseDataGrid } from "../BaseDataGrid";
import type {
  CrudCommandFactory,
  GridColumnV2,
  GridRowModel,
} from "@/components/DataGrid/types";
import type { InspectorPanelProps } from "@/components/DataGrid/components/inspector";
import { useCrudStore } from "@/stores/crudStore";
import type { EditableDataGridRef } from "../EditableDataGrid";

vi.mock("../EditableDataGrid", async () => {
  const ReactModule = await import("react");

  const MockEditableDataGrid = ReactModule.forwardRef<
    EditableDataGridRef,
    Record<string, unknown>
  >(function MockEditableDataGrid(props, ref) {
    const rows = (props.rows as GridRowModel[] | undefined) ?? [];
    const columns = (props.columns as GridColumnV2[] | undefined) ?? [];
    const onCellClicked = props.onCellClicked as
      | ((event: {
          cell: [number, number];
          rowIndex: number;
          columnIndex: number;
          column: GridColumnV2;
          row: GridRowModel;
        }) => void)
      | undefined;
    const clickedRef = ReactModule.useRef(false);

    ReactModule.useEffect(() => {
      if (clickedRef.current || !onCellClicked) return;
      const row = rows[0];
      const column = columns[0];
      if (!row || !column) return;

      clickedRef.current = true;
      onCellClicked({
        cell: [0, 0],
        rowIndex: 0,
        columnIndex: 0,
        column,
        row,
      });
    }, [columns, onCellClicked, rows]);

    ReactModule.useImperativeHandle(
      ref,
      () =>
        ({
          focus: () => {},
          appendRow: async () => {},
        }) as EditableDataGridRef,
      [],
    );

    return <div data-testid="mock-editable-grid" />;
  });

  return { EditableDataGrid: MockEditableDataGrid };
});

const columns: GridColumnV2[] = [
  {
    id: "productSku",
    field: "productSku",
    title: "productSku",
    name: "productSku",
    type: "text",
    width: 180,
    meta: {
      name: "productSku",
      db_type: "text",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 0,
    },
  },
];

const rows: GridRowModel[] = [
  {
    __index: {
      value: 2,
      db_type: "number",
      value_type: "Integer",
      is_truncated: false,
    },
    productSku: {
      value: "AUDIO-001",
      db_type: "string",
      value_type: "Text",
      is_truncated: false,
    },
  },
];

const firstColumn = columns[0];
if (!firstColumn) {
  throw new Error("Test columns are not initialized");
}

const commandFactory: CrudCommandFactory = {
  connectionId: "mongo-conn",
  database: "test-db",
  schema: undefined,
  table: "orders",
  primaryKeyColumns: ["__index"],
  columnNameToFieldMap: new Map([["productSku", "productSku"]]),
  columnByFieldMap: new Map([["productSku", firstColumn]]),
  getRowKey: (_row, index) => `row-${index}`,
  createEditCommand: () => null,
  createInsertCommand: () => {
    throw new Error("not used");
  },
  createDeleteCommand: () => {
    throw new Error("not used");
  },
};

const mockGetCellContent = (): GridCell => ({
  kind: GridCellKind.Text,
  data: "",
  displayData: "",
  allowOverlay: false,
  readonly: true,
});

describe("BaseDataGrid inspector staged preview", () => {
  beforeEach(() => {
    useCrudStore.getState().discardAll();
  });

  it("shows staged value in inspector selectedRows for document paradigm", async () => {
    useCrudStore.getState().stageCommand({
      id: "update-1",
      type: "data.update",
      target: {
        connectionId: "mongo-conn",
        database: "test-db",
        table: "orders",
      },
      payload: {
        column: "items.2.productSku",
        primaryKeys: {
          _id: "order-1",
          __index: 2,
        },
        oldValue: "AUDIO-001",
        newValue: "AUDIO-001XXX",
      },
      metadata: {
        timestamp: new Date().toISOString(),
        description: "Update nested item sku",
        gridColumn: "productSku",
      },
      state: "staged",
    });

    let latestInspectorProps: InspectorPanelProps | null = null;

    render(
      <BaseDataGrid
        gridId="inspector-staged-preview"
        rows={rows}
        columns={columns}
        getCellContent={mockGetCellContent}
        connectionId="mongo-conn"
        database="test-db"
        tableName="orders"
        paradigm="document"
        commandFactory={commandFactory}
        inspectorOpen={true}
        renderInspectorPanel={(props) => {
          latestInspectorProps = props;
          return <div data-testid="inspector-probe" />;
        }}
      />,
    );

    await waitFor(() => {
      const selectedRows = latestInspectorProps?.selectedRows ?? [];
      expect(selectedRows.length).toBe(1);
      expect(
        (selectedRows[0]?.productSku as { value?: unknown } | undefined)?.value,
      ).toBe("AUDIO-001XXX");
    });
  });
});
