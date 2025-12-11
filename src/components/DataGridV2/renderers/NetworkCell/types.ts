import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

export type NetworkCellKind = "inet-cell" | "cidr-cell" | "macaddr-cell";

interface NetworkCellData {
  kind: NetworkCellKind;
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface NetworkCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: NetworkCellData;
  copyData: string;
  readonly?: boolean;
}

export interface InetCustomCell extends NetworkCustomCell {
  data: NetworkCellData & { kind: "inet-cell" | "cidr-cell" };
}

export interface MacAddrCustomCell extends NetworkCustomCell {
  data: NetworkCellData & { kind: "macaddr-cell" };
}

