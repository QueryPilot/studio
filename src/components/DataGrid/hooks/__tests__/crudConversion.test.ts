import { describe, it, expect } from "vitest";
import { convertEditValue } from "../crudConversion";

describe("convertEditValue", () => {
  it("keeps bigint strings beyond the safe integer range", () => {
    const value = "9223372036854775807";
    expect(convertEditValue(value, "bigint")).toBe(value);
  });

  it("keeps integer strings for integer columns", () => {
    expect(convertEditValue("42", "integer")).toBe("42");
  });

  it("keeps decimal strings for numeric columns", () => {
    expect(convertEditValue("3.14", "numeric")).toBe("3.14");
  });
});
