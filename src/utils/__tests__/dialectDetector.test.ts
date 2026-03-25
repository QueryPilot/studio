import { describe, expect, it } from "vitest";

import { detectDialectForObject, detectSqlDialect } from "../dialectDetector";
import { DbType } from "@/types/connection";

describe("detectSqlDialect", () => {
  it("returns the Oracle dialect for Oracle connections", () => {
    expect(detectSqlDialect(DbType.Oracle)).toBe("oracle");
    expect(detectSqlDialect("oracle")).toBe("oracle");
  });
});

describe("detectDialectForObject", () => {
  it("keeps Oracle object definitions on the Oracle dialect", () => {
    expect(detectDialectForObject(DbType.Oracle, "package")).toBe("oracle");
    expect(detectDialectForObject(DbType.Oracle, "synonym")).toBe("oracle");
  });
});
