import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const syncSchemaToRustMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/hooks/useRustSchemaSync", () => ({
  syncSchemaToRust: (...args: unknown[]) => syncSchemaToRustMock(...args),
}));

import { linterCoordinator } from "./linter-coordinator";

describe("linterCoordinator schema sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    syncSchemaToRustMock.mockReset();
    linterCoordinator.clearCache();
  });

  it("syncs schema before validation when connection context is present", async () => {
    syncSchemaToRustMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{ diagnostics: unknown[] }>((resolve) => {
      linterCoordinator.requestLint(
        {
          sql: "SELECT c.bepomap FROM customers c",
          dialect: "postgresql",
          connectionId: "conn-1",
          schema: "public",
        },
        resolve,
      );
    });

    await callbackResult;

    expect(syncSchemaToRustMock).toHaveBeenCalledWith("conn-1", "public");
    expect(invokeMock).toHaveBeenCalledWith("sql_validate", {
      request: {
        sql: "SELECT c.bepomap FROM customers c",
        dialect: "postgresql",
        connectionId: "conn-1",
        schema: "public",
      },
    });
  });

  it("skips schema sync when connection context is absent", async () => {
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{ diagnostics: unknown[] }>((resolve) => {
      linterCoordinator.requestLint(
        {
          sql: "SELECT 1",
          dialect: "postgresql",
        },
        resolve,
      );
    });

    await callbackResult;

    expect(syncSchemaToRustMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("sql_validate", {
      request: {
        sql: "SELECT 1",
        dialect: "postgresql",
      },
    });
  });
});
