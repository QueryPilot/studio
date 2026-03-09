import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const syncSchemaToRustMock = vi.hoisted(() => vi.fn());
const getRustSchemaSyncStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/hooks/useRustSchemaSync", () => ({
  syncSchemaToRust: (...args: unknown[]) => syncSchemaToRustMock(...args),
  getRustSchemaSyncStatus: (...args: unknown[]) =>
    getRustSchemaSyncStatusMock(...args),
}));

import { linterCoordinator } from "./linter-coordinator";

describe("linterCoordinator schema sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    syncSchemaToRustMock.mockReset();
    getRustSchemaSyncStatusMock.mockReset();
    linterCoordinator.clearCache();
  });

  it("validates without triggering schema sync on the lint hot path", async () => {
    getRustSchemaSyncStatusMock.mockReturnValue("stale_schema");
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{
      diagnostics: unknown[];
      status: string;
    }>((resolve) => {
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

    await expect(callbackResult).resolves.toMatchObject({
      diagnostics: [],
      status: "stale_schema",
    });

    expect(syncSchemaToRustMock).not.toHaveBeenCalled();
    expect(getRustSchemaSyncStatusMock).toHaveBeenCalledWith("conn-1", "public");
    expect(invokeMock).toHaveBeenCalledWith("sql_validate", {
      request: {
        sql: "SELECT c.bepomap FROM customers c",
        dialect: "postgresql",
        connectionId: "conn-1",
        schema: "public",
      },
    });
  });

  it("reports ready status when no schema context is required", async () => {
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{
      diagnostics: unknown[];
      status: string;
    }>((resolve) => {
      linterCoordinator.requestLint(
        {
          sql: "SELECT 1",
          dialect: "postgresql",
        },
        resolve,
      );
    });

    await expect(callbackResult).resolves.toMatchObject({
      diagnostics: [],
      status: "ready",
    });

    expect(syncSchemaToRustMock).not.toHaveBeenCalled();
    expect(getRustSchemaSyncStatusMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("sql_validate", {
      request: {
        sql: "SELECT 1",
        dialect: "postgresql",
      },
    });
  });

  it("uses a dialect-aware fallback schema for sqlite validation", async () => {
    syncSchemaToRustMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{ diagnostics: unknown[] }>((resolve) => {
      linterCoordinator.requestLint(
        {
          sql: "SELECT * FROM sqlite_master",
          dialect: "sqlite",
          connectionId: "conn-sqlite",
        },
        resolve,
      );
    });

    await callbackResult;

    expect(syncSchemaToRustMock).toHaveBeenCalledWith("conn-sqlite", "main");
  });

  it("does not force a PostgreSQL schema fallback for mysql validation", async () => {
    invokeMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const callbackResult = new Promise<{ diagnostics: unknown[] }>((resolve) => {
      linterCoordinator.requestLint(
        {
          sql: "SELECT * FROM users",
          dialect: "mysql",
          connectionId: "conn-mysql",
        },
        resolve,
      );
    });

    await callbackResult;

    expect(syncSchemaToRustMock).not.toHaveBeenCalled();
  });
});
