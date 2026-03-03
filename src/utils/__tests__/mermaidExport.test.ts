import { describe, expect, it } from "vitest";
import { generateMermaidERD } from "../mermaidExport";
import type { TableStructure } from "@/types/tableStructure";

const makeTable = (overrides: Partial<TableStructure>): TableStructure => ({
  name: "test",
  schema: "public",
  database: "db",
  columns: [],
  primaryKeys: [],
  foreignKeys: [],
  indexes: [],
  constraints: [],
  triggers: [],
  ...overrides,
});

describe("generateMermaidERD", () => {
  it("generates entity block with columns and PK/FK annotations", () => {
    const tables: TableStructure[] = [
      makeTable({
        name: "users",
        columns: [
          { name: "id", db_type: "integer", nullable: false, is_pk: true, is_fk: false, ordinal: 1, default: null },
          { name: "name", db_type: "varchar(255)", nullable: true, is_pk: false, is_fk: false, ordinal: 2, default: null },
          { name: "dept_id", db_type: "integer", nullable: true, is_pk: false, is_fk: true, ordinal: 3, default: null },
        ],
        primaryKeys: ["id"],
        foreignKeys: [
          { name: "fk_dept", columns: ["dept_id"], foreignTable: "departments", foreignSchema: "public", foreignColumns: ["id"] },
        ],
      }),
      makeTable({
        name: "departments",
        columns: [
          { name: "id", db_type: "integer", nullable: false, is_pk: true, is_fk: false, ordinal: 1, default: null },
          { name: "name", db_type: "varchar(100)", nullable: false, is_pk: false, is_fk: false, ordinal: 2, default: null },
        ],
        primaryKeys: ["id"],
      }),
    ];

    const result = generateMermaidERD(tables);

    expect(result).toContain("erDiagram");
    expect(result).toContain("users {");
    expect(result).toContain("integer id PK");
    expect(result).toContain("varchar(255) name");
    expect(result).toContain("integer dept_id FK");
    expect(result).toContain("departments {");
    expect(result).toContain("integer id PK");
    expect(result).toContain("users }o--|| departments");
  });

  it("returns just erDiagram with no tables when empty", () => {
    const result = generateMermaidERD([]);
    expect(result.trim()).toBe("erDiagram");
  });

  it("sanitizes column types with special characters", () => {
    const tables: TableStructure[] = [
      makeTable({
        name: "orders",
        columns: [
          { name: "status", db_type: "enum('pending','confirmed','shipped')", nullable: false, is_pk: false, is_fk: false, ordinal: 1, default: null },
          { name: "note", db_type: "character varying(255)", nullable: true, is_pk: false, is_fk: false, ordinal: 2, default: null },
        ],
      }),
    ];

    const result = generateMermaidERD(tables);
    expect(result).toContain("enum(pendingconfirmedshipped) status");
    expect(result).toContain("charactervarying(255) note");
    expect(result).not.toContain("'");
  });

  it("only includes relationships where both tables are present", () => {
    const tables: TableStructure[] = [
      makeTable({
        name: "orders",
        foreignKeys: [
          { name: "fk_customer", columns: ["customer_id"], foreignTable: "customers", foreignSchema: "public", foreignColumns: ["id"] },
        ],
      }),
    ];

    const result = generateMermaidERD(tables);
    expect(result).not.toContain("customers");
    expect(result).not.toContain("}o--||");
  });
});
