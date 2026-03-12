import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { databaseService } from "../databaseService";
import { IntrospectionService } from "../introspectionService";

vi.mock("../introspectionService", () => ({
  IntrospectionService: {
    getObjectDefinition: vi.fn(),
  },
}));

describe("databaseService.getObjectDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces string errors from introspection instead of 'Unknown error'", async () => {
    (IntrospectionService.getObjectDefinition as unknown as Mock)
      .mockRejectedValue("permission denied for function pg_get_functiondef");

    await expect(
      databaseService.getObjectDefinition(
        "conn-1",
        "db",
        "public",
        "similarity_op",
        "function",
      ),
    ).rejects.toThrow(
      "Failed to get definition for function public.similarity_op: permission denied for function pg_get_functiondef",
    );
  });

  it("surfaces message from plain-object rejections", async () => {
    (IntrospectionService.getObjectDefinition as unknown as Mock)
      .mockRejectedValue({ message: "permission denied for schema public" });

    await expect(
      databaseService.getObjectDefinition(
        "conn-1",
        "db",
        "public",
        "similarity_op",
        "function",
      ),
    ).rejects.toThrow(
      "Failed to get definition for function public.similarity_op: permission denied for schema public",
    );
  });
});
