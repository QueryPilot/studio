import { describe, expect, it } from "vitest";
import { prepareSqlForLint } from "./dialect-lint-adapter";

describe("prepareSqlForLint", () => {
  it("normalizes PostgreSQL EXPLAIN ANALYSE for semantic linting", () => {
    const sql = `EXPLAIN ANALYSE
SELECT DISTINCT
  ON (customer_client_id) *
FROM
  client_sales_contexts
WHERE
  created_at >= '2026-02-16T15:40:50.966099+00:00'
  AND created_at <= '2026-03-16T15:40:55.966099+00:00'
  AND client_channel IN ('KXA', 'VIB')
  AND product_id = 8;`;

    const prepared = prepareSqlForLint(sql, "postgresql");

    expect(prepared.canRunSemantic).toBe(true);
    expect(prepared.canonicalSql).toContain("EXPLAIN ANALYZE");
    expect(prepared.canonicalSql).not.toContain("ANALYSE");
    expect(
      prepared.fastDiagnostics.some((d) => d.source === "syntax"),
    ).toBe(false);
  });

  it("normalizes PostgreSQL EXPLAIN utility options without shifting offsets", () => {
    const sql = "EXPLAIN (ANALYSE, FORMAT TEXT) SELECT * FROM users";

    const prepared = prepareSqlForLint(sql, "postgresql");

    expect(prepared.canonicalSql).toBe(
      "EXPLAIN (ANALYZE, FORMAT TEXT) SELECT * FROM users",
    );
    expect(prepared.offsetMap[0]).toBe(0);
    expect(prepared.offsetMap[prepared.offsetMap.length - 1]).toBe(sql.length);
  });

  it("does not rewrite ANALYSE identifiers inside explained statements", () => {
    const sql = "EXPLAIN CREATE INDEX idx_users ON ANALYSE(id)";

    const prepared = prepareSqlForLint(sql, "postgresql");

    expect(prepared.canonicalSql).toBe(sql);
  });

  it("does not flag valid identifiers that resemble typo keywords", () => {
    const prepared = prepareSqlForLint(
      "SELECT form FROM metrics",
      "postgresql",
    );

    expect(
      prepared.fastDiagnostics.some((d) => d.message.includes("Possible typo")),
    ).toBe(false);
  });

  it("still warns for UPDATE without a real WHERE even when identifiers contain where", () => {
    const prepared = prepareSqlForLint(
      "UPDATE users SET somewhere = 1",
      "postgresql",
    );

    expect(
      prepared.fastDiagnostics.some((d) =>
        d.message.includes("without WHERE clause"),
      ),
    ).toBe(true);
  });

  it("warns when UPDATE has no top-level WHERE even if subqueries contain WHERE", () => {
    const prepared = prepareSqlForLint(
      "UPDATE users SET score = (SELECT 1 WHERE 1 = 1)",
      "postgresql",
    );

    expect(
      prepared.fastDiagnostics.some((d) =>
        d.message.includes("without WHERE clause"),
      ),
    ).toBe(true);
  });
});
