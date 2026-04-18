import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { erdCache } from "@/services/erdCache";
import type { DBMLSchema } from "@/services/dbmlService";

const stub = (tag: string): DBMLSchema => ({
  dbml: `// ${tag}`,
  ast: null,
  metadata: {
    tableCount: 1,
    relationshipCount: 0,
    enumCount: 0,
    version: "1.0",
    generatedAt: new Date(),
  },
  relationships: [],
  tables: [],
});

describe("erdCache schema-set keying", () => {
  beforeEach(() => {
    erdCache.clear();
  });

  it("treats [a,b] and [b,a] as the same cache entry (order-independent)", () => {
    erdCache.setSchemas("c1", "db", ["public", "reporting"], stub("ab"));
    const hit = erdCache.getSchemas("c1", "db", ["reporting", "public"]);
    expect(hit?.dbml).toBe("// ab");
  });

  it("keys different schema sets distinctly", () => {
    erdCache.setSchemas("c1", "db", ["public"], stub("p"));
    erdCache.setSchemas("c1", "db", ["public", "reporting"], stub("pr"));
    expect(erdCache.getSchemas("c1", "db", ["public"])?.dbml).toBe("// p");
    expect(erdCache.getSchemas("c1", "db", ["public", "reporting"])?.dbml).toBe("// pr");
  });

  it("expires entries after TTL (5 minutes)", () => {
    vi.useFakeTimers();
    try {
      erdCache.setSchemas("c1", "db", ["public"], stub("p"));
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(erdCache.getSchemas("c1", "db", ["public"])).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps at 32 entries per connection with LRU eviction", () => {
    for (let i = 0; i < 33; i++) {
      erdCache.setSchemas("c1", "db", [`s${i}`], stub(`s${i}`));
    }
    // Oldest entry (s0) should have been evicted.
    expect(erdCache.getSchemas("c1", "db", ["s0"])).toBeNull();
    expect(erdCache.getSchemas("c1", "db", ["s32"])?.dbml).toBe("// s32");
  });

  afterEach(() => {
    erdCache.clear();
  });
});
