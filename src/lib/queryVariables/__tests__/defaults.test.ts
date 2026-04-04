import { describe, it, expect } from "vitest";
import { inferVariableType } from "../defaults";

describe("inferVariableType", () => {
  it("returns 'date' for date-related names", () => {
    expect(inferVariableType("start_date")).toBe("date");
    expect(inferVariableType("created_at")).toBe("date");
    expect(inferVariableType("date")).toBe("date");
    expect(inferVariableType("expires_on")).toBe("date");
  });

  it("returns 'datetime' for datetime/timestamp names", () => {
    expect(inferVariableType("created_timestamp")).toBe("datetime");
    expect(inferVariableType("datetime")).toBe("datetime");
  });

  it("returns 'number' for numeric names", () => {
    expect(inferVariableType("user_id")).toBe("number");
    expect(inferVariableType("count")).toBe("number");
    expect(inferVariableType("limit")).toBe("number");
    expect(inferVariableType("total_amount")).toBe("number");
    expect(inferVariableType("page")).toBe("number");
  });

  it("returns 'boolean' for boolean names", () => {
    expect(inferVariableType("active")).toBe("boolean");
    expect(inferVariableType("is_enabled")).toBe("boolean");
    expect(inferVariableType("deleted_flag")).toBe("boolean");
  });

  it("returns 'text' for generic names", () => {
    expect(inferVariableType("region")).toBe("text");
    expect(inferVariableType("username")).toBe("text");
    expect(inferVariableType("query")).toBe("text");
  });

  it("returns 'text' for positional parameters", () => {
    expect(inferVariableType("$1")).toBe("text");
    expect(inferVariableType("#1")).toBe("text");
    expect(inferVariableType("#42")).toBe("text");
  });
});
