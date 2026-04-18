import { describe, it, expectTypeOf } from "vitest";
import type { TabMetadata } from "@/types/workbench";

describe("TabMetadata.schemaOverride", () => {
  it("accepts an ordered visibleSchemas list with optional effectiveDatabase", () => {
    const meta: TabMetadata = {
      schemaOverride: { visibleSchemas: ["reporting", "public"] },
    };
    expectTypeOf(meta.schemaOverride).toEqualTypeOf<
      | { visibleSchemas: string[]; effectiveDatabase?: string }
      | undefined
    >();
  });
});
