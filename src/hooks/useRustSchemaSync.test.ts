import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauriMock = vi.hoisted(() => vi.fn(() => true));
const setSchemaMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    tableCount: 0,
    columnCount: 0,
  }),
);
const clearSchemaMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/utils/tauri", () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock("@/services/schemaCache", () => ({
  schemaCache: {
    getTables: vi.fn().mockResolvedValue([]),
    getRelationshipGraph: vi.fn().mockResolvedValue({
      relationships: new Map(),
      reverseRelationships: new Map(),
    }),
    getFunctions: vi.fn().mockResolvedValue([]),
    getTableColumns: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/services/sqlEngineService", () => ({
  SqlEngineService: {
    setSchema: (...args: unknown[]) => setSchemaMock(...args),
    clearSchema: (...args: unknown[]) => clearSchemaMock(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  clearRustSchema,
  getRustSchemaSyncStatus,
  syncSchemaToRust,
} from "./useRustSchemaSync";

describe("getRustSchemaSyncStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T00:00:00.000Z"));
    setSchemaMock.mockClear();
    clearSchemaMock.mockClear();
    isTauriMock.mockReturnValue(true);
  });

  afterEach(async () => {
    await clearRustSchema("conn-test");
    vi.useRealTimers();
  });

  it("remains ready after a successful sync until explicit invalidation", async () => {
    await syncSchemaToRust("conn-test", "public");

    expect(getRustSchemaSyncStatus("conn-test", "public")).toBe("ready");

    vi.setSystemTime(new Date("2026-03-08T00:00:06.000Z"));

    expect(getRustSchemaSyncStatus("conn-test", "public")).toBe("ready");
  });
});
