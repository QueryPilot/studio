import { describe, expect, it } from "vitest";
import { filterDocumentsForCurrentLevel } from "../useDocumentData";
import type { DocumentFilter } from "@/utils/documentFilterParser";

describe("filterDocumentsForCurrentLevel", () => {
  const documents = [
    { _id: "1", customer: "Alice", total: 120 },
    { _id: "2", customer: "Bob", total: 80 },
  ] as Record<string, unknown>[];

  const searchFilter: DocumentFilter = {
    mode: "search",
    searchText: "Alice",
    description: 'Search: "Alice"',
  };

  it("applies search filter at root level", () => {
    const result = filterDocumentsForCurrentLevel(
      documents,
      searchFilter,
      true,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.customer).toBe("Alice");
  });

  it("does not apply root quick filter search while drilled into nested data", () => {
    const result = filterDocumentsForCurrentLevel(
      documents,
      searchFilter,
      false,
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.customer).toBe("Alice");
    expect(result[1]?.customer).toBe("Bob");
  });
});
