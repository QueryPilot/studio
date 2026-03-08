import { describe, expect, it } from "vitest";
import {
  extractMongoResultDocuments,
  normalizeMongoResult,
} from "../mongo-result-state";

describe("normalizeMongoResult", () => {
  it("normalizes find document arrays into data-view results", () => {
    const result = normalizeMongoResult({
      operation: "find",
      collection: "users",
      result: [{ _id: "1", name: "Ada" }],
    });

    expect(result.kind).toBe("documents");
    expect(result.operation).toBe("find");
    expect(result.supportsDataView).toBe(true);
    expect(result.collection).toBe("users");
    expect(extractMongoResultDocuments(result)).toEqual([
      { _id: "1", name: "Ada" },
    ]);
  });

  it("normalizes aggregate document arrays into data-view results", () => {
    const result = normalizeMongoResult({
      operation: "aggregate",
      collection: "orders",
      result: [{ _id: "status:new", count: 5 }],
    });

    expect(result.kind).toBe("documents");
    expect(result.operation).toBe("aggregate");
    expect(result.supportsDataView).toBe(true);
    expect(result.collection).toBe("orders");
    expect(extractMongoResultDocuments(result)).toEqual([
      { _id: "status:new", count: 5 },
    ]);
  });

  it("normalizes count results into scalar results", () => {
    const result = normalizeMongoResult({
      operation: "count",
      collection: "users",
      result: 42,
    });

    expect(result.kind).toBe("scalar");
    expect(result.operation).toBe("count");
    expect(result.supportsDataView).toBe(false);
    expect(result.collection).toBe("users");
    expect(result.raw).toBe(42);
  });

  it("normalizes command object results into command results", () => {
    const result = normalizeMongoResult({
      operation: "command",
      result: { ok: 1, connectionStatus: { authInfo: {} } },
    });

    expect(result.kind).toBe("command");
    expect(result.operation).toBe("command");
    expect(result.supportsDataView).toBe(false);
    expect(extractMongoResultDocuments(result)).toBeNull();
  });

  it("marks command responses with cursor batches as data-view capable", () => {
    const result = normalizeMongoResult({
      operation: "command",
      collection: "users",
      result: {
        ok: 1,
        cursor: {
          firstBatch: [{ _id: "1", name: "Ada" }],
        },
      },
    });

    expect(result.kind).toBe("command");
    expect(result.operation).toBe("command");
    expect(result.supportsDataView).toBe(true);
    expect(result.collection).toBe("users");
    expect(extractMongoResultDocuments(result)).toEqual([
      { _id: "1", name: "Ada" },
    ]);
  });

  it("normalizes thrown errors into error results", () => {
    const result = normalizeMongoResult({
      operation: "find",
      collection: "users",
      error: new Error("boom"),
    });

    expect(result.kind).toBe("error");
    expect(result.operation).toBe("find");
    expect(result.supportsDataView).toBe(false);
    expect(result.collection).toBe("users");
    expect(result.errorMessage).toBe("boom");
  });
});
