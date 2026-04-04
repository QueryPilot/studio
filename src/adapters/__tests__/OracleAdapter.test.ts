import { describe, expect, it } from "vitest";
import { OracleAdapter } from "../dialects/OracleAdapter";

describe("OracleAdapter", () => {
  const adapter = new OracleAdapter("oracle-test");

  it("injects a synthetic ROWID column when requested", () => {
    const sql = adapter.select(
      { schema: "APP", table: "USERS" },
      {
        columns: ["__qp_rowid"],
        limit: 10,
      },
    );

    expect(sql).toContain('SELECT t.ROWID AS "__qp_rowid", t.* FROM "APP"."USERS" t');
    expect(sql).toContain("FETCH FIRST 10 ROWS ONLY");
  });

  it("uses Oracle pagination syntax", () => {
    const sql = adapter.select(
      { schema: "APP", table: "USERS" },
      {
        columns: ["ID", "EMAIL"],
        orderBy: [{ column: "ID", direction: "ASC" }],
        limit: 25,
        offset: 50,
      },
    );

    expect(sql).toContain('SELECT "ID", "EMAIL" FROM "APP"."USERS"');
    expect(sql).toContain('ORDER BY "ID" ASC');
    expect(sql).toContain("OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY");
  });

  it("uses Oracle-compatible joins for embedded foreign keys", () => {
    const sql = adapter.selectWithEmbeddedFK(
      { schema: "APP", table: "ORDERS" },
      {
        limit: 10,
        embeddedFKs: [
          {
            fkColumn: "CUSTOMER_ID",
            refSchema: "APP",
            refTable: "CUSTOMERS",
            refPkColumn: "ID",
            refDisplayColumns: ["NAME"],
          },
        ],
      },
    );

    expect(sql).toContain('LEFT JOIN "APP"."CUSTOMERS" "t1"');
    expect(sql).not.toContain('LEFT JOIN "APP"."CUSTOMERS" AS "t1"');
    expect(sql).toContain('FETCH FIRST 10 ROWS ONLY');
  });

  it("builds package definitions using DBMS_METADATA", () => {
    const sql = adapter.getObjectDefinitionQuery("package", "APP", "ORDER_API");

    expect(sql).toContain("DBMS_METADATA.GET_DDL('PACKAGE'");
    expect(sql).toContain("DBMS_METADATA.GET_DDL('PACKAGE_BODY'");
    expect(sql).toContain("ORDER_API");
  });

  it("uses Oracle ROWID pseudo column in update and delete matchers", () => {
    const updateSql = adapter.update(
      { schema: "APP", table: "USERS" },
      { EMAIL: "alice@example.com" },
      { __qp_rowid: "AAAPr9AAEAAAACXAAA" },
      { columnInfos: [{ name: "EMAIL", dbType: "VARCHAR2" }] },
    );

    const deleteSql = adapter.delete(
      { schema: "APP", table: "USERS" },
      { __qp_rowid: "AAAPr9AAEAAAACXAAA" },
    );

    expect(updateSql).toContain("WHERE ROWID = 'AAAPr9AAEAAAACXAAA'");
    expect(updateSql).not.toContain('"__qp_rowid"');
    expect(deleteSql).toContain("WHERE ROWID = 'AAAPr9AAEAAAACXAAA'");
    expect(deleteSql).not.toContain('"__qp_rowid"');
  });

  it("builds Oracle sequence DDL", () => {
    const sql = adapter.createSequence("APP", {
      name: "ORDER_SEQ",
      startValue: 1000,
      increment: 5,
      cache: 20,
      cycle: false,
    });

    expect(sql).toContain('CREATE SEQUENCE "APP"."ORDER_SEQ"');
    expect(sql).toContain("START WITH 1000");
    expect(sql).toContain("INCREMENT BY 5");
    expect(sql).toContain("CACHE 20");
    expect(sql).toContain("NOCYCLE");
  });
});
