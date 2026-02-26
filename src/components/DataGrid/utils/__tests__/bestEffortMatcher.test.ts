import { describe, expect, it, vi } from "vitest";
import { canProceedBestEffort } from "../bestEffortMatcher";

describe("canProceedBestEffort", () => {
  it("blocks when matcher is empty", async () => {
    const adapter = {
      select: vi.fn(),
      execute: vi.fn(),
    };

    const result = await canProceedBestEffort({
      adapter,
      target: { schema: "public", table: "users" },
      where: {},
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_matcher",
      matchCount: 0,
    });
    expect(adapter.select).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("allows operation when exactly one row matches", async () => {
    const adapter = {
      select: vi.fn(() => "SELECT 1"),
      execute: vi.fn(() => Promise.resolve({ rows: [[1]], columns: [] })),
    };

    const result = await canProceedBestEffort({
      adapter,
      target: { schema: "public", table: "users" },
      where: { email: "alice@example.com" },
    });

    expect(result).toEqual({
      ok: true,
      matchCount: 1,
    });
    expect(adapter.select).toHaveBeenCalledWith(
      { schema: "public", table: "users" },
      { where: { email: "alice@example.com" }, limit: 2 },
    );
  });

  it("blocks with not_found when no rows match", async () => {
    const adapter = {
      select: vi.fn(() => "SELECT 1"),
      execute: vi.fn(() => Promise.resolve({ rows: [], columns: [] })),
    };

    const result = await canProceedBestEffort({
      adapter,
      target: { schema: "public", table: "users" },
      where: { email: "missing@example.com" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      matchCount: 0,
    });
  });

  it("blocks with ambiguous when multiple rows match", async () => {
    const adapter = {
      select: vi.fn(() => "SELECT 1"),
      execute: vi.fn(() => Promise.resolve({ rows: [[1], [2]], columns: [] })),
    };

    const result = await canProceedBestEffort({
      adapter,
      target: { schema: "public", table: "users" },
      where: { status: "active" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "ambiguous",
      matchCount: 2,
    });
  });
});
