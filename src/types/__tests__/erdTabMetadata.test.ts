import { describe, it, expect } from "vitest";
import { readErdTabSchemas } from "@/types/erdTabMetadata";

describe("ERD tab metadata migration-on-read", () => {
  it("reads schemas[] when present", () => {
    const meta = { type: "erd", schemas: ["public", "reporting"] } as const;
    expect(readErdTabSchemas(meta)).toEqual(["public", "reporting"]);
  });

  it("synthesizes schemas from legacy schema field", () => {
    const meta = { type: "erd", schema: "analytics" } as const;
    expect(readErdTabSchemas(meta)).toEqual(["analytics"]);
  });

  it("returns empty array when neither is present", () => {
    const meta = { type: "erd" } as const;
    expect(readErdTabSchemas(meta)).toEqual([]);
  });

  it("does not mutate the input object (legacy field coexists)", () => {
    const meta = { type: "erd", schema: "old" } as { type: "erd"; schema?: string; schemas?: string[] };
    readErdTabSchemas(meta);
    expect(meta.schema).toBe("old");
    expect(meta.schemas).toBeUndefined();
  });

  it("prefers schemas[] when both are present", () => {
    const meta = { type: "erd", schema: "legacy", schemas: ["a", "b"] } as const;
    expect(readErdTabSchemas(meta)).toEqual(["a", "b"]);
  });
});
