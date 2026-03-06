import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/ai/constants";

describe("buildSystemPrompt", () => {
  it("includes strict action execution guardrails", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("Never claim work is queued/executed");
    expect(prompt).toContain("Never provide raw executable SQL as plain text");
    expect(prompt).toContain("Multi-database default");
  });

  it("includes schema context when provided", () => {
    const prompt = buildSystemPrompt({
      databaseType: "postgresql",
      schemaJson: JSON.stringify({ connections: [{ id: "conn-1" }] }),
    });

    expect(prompt).toContain("Current Database");
    expect(prompt).toContain("Database Context");
    expect(prompt).toContain('"id":"conn-1"');
  });
});
