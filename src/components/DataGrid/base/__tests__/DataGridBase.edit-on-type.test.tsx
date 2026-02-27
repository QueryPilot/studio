import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import { DataGridBase } from "../DataGridBase";
import type { GridColumnV2 } from "@/components/DataGrid/types";

const { dataEditorPropsRef } = vi.hoisted(() => ({
  dataEditorPropsRef: {
    current: null as Record<string, unknown> | null,
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@glideapps/glide-data-grid", () => {
  const MockDataEditor = React.forwardRef(function MockDataEditor(
    props: Record<string, unknown>,
    _ref: React.Ref<unknown>,
  ) {
    dataEditorPropsRef.current = props;
    return <div data-testid="mock-data-editor" />;
  });

  return {
    __esModule: true,
    default: MockDataEditor,
  };
});

const mockColumns: GridColumnV2[] = [
  {
    id: "col_0",
    field: "col_0",
    title: "Column 1",
    name: "col_0",
    width: 120,
    type: "text",
  },
];

const mockGetCellContent = (): GridCell => ({
  kind: GridCellKind.Text,
  data: "",
  displayData: "",
  allowOverlay: true,
  readonly: false,
});

describe("DataGridBase", () => {
  beforeEach(() => {
    dataEditorPropsRef.current = null;
  });

  it("enables edit on type in Glide DataEditor", () => {
    render(
      <DataGridBase
        columns={mockColumns}
        rowCount={1}
        getCellContent={mockGetCellContent}
      />,
    );

    expect(dataEditorPropsRef.current).not.toBeNull();
    expect(dataEditorPropsRef.current?.editOnType).toBe(true);
  });
});
