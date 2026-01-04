import { describe, it, expect } from "vitest";
import { getTriggerModifiedFields } from "./utils";
import type { TriggerGridRow } from "./types";

describe("getTriggerModifiedFields", () => {
  it("flags name and enabled changes", () => {
    const row: TriggerGridRow = {
      row_number: 1,
      name: "trigger_new",
      event: "INSERT",
      timing: "BEFORE",
      level: "ROW",
      enabled: "NO",
      function: "fn_test",
      definition: "WHEN (true)",
      _original: {
        name: "trigger_old",
        event: "INSERT",
        timing: "BEFORE",
        level: "ROW",
        enabled: true,
        function: "fn_test",
        condition: "WHEN (true)",
      },
      _isModified: true,
      _pendingName: "trigger_new",
      _pendingEnabled: false,
    };

    const fields = getTriggerModifiedFields(row);
    expect(fields.has("name")).toBe(true);
    expect(fields.has("enabled")).toBe(true);
  });
});
