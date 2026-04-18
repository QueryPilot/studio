import { describe, expect, it } from "vitest";
import { schemaNamesForAttachedDatabase } from "../duckDbAttachedDatabaseSectionHelpers";

describe("schemaNamesForAttachedDatabase", () => {
  it("extracts schema names for the selected attached database", () => {
    expect(
      schemaNamesForAttachedDatabase(
        [
          { name: "main" },
          { name: "pg.public" },
          { name: "pg.test" },
          { name: "lake.main" },
        ],
        "pg",
      ),
    ).toEqual(["public", "test"]);
  });

  it("sorts and deduplicates discovered schemas", () => {
    expect(
      schemaNamesForAttachedDatabase(
        ["pg.test", "pg.public", "pg.public"],
        "pg",
      ),
    ).toEqual(["public", "test"]);
  });
});
