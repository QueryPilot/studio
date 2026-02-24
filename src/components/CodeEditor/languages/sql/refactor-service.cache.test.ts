import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/utils/tauri", () => ({
  isTauri: () => true,
}));

import { clearOutlineCache, getOutline } from "./refactor-service";

describe("refactor-service outline cache", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clearOutlineCache();
  });

  it("caches multiple SQL documents independently", async () => {
    invokeMock.mockResolvedValue({
      statements: [],
      parse_status: "Full",
    });

    await getOutline("SELECT 1", "postgresql");
    await getOutline("SELECT 2", "postgresql");
    await getOutline("SELECT 1", "postgresql");

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
