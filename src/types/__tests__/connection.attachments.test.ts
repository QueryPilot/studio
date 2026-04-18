import { describe, it, expect } from "vitest";
import type { AttachmentKind, DatabaseEntry } from "@/types/connection";

describe("Attachment type shape", () => {
  it("accepts all kinds", () => {
    const kinds: AttachmentKind[] = ["iceberg", "delta", "ducklake", "postgres", "mysql", "sqlite", "duckdb"];
    expect(kinds.length).toBe(7);
  });
  it("DatabaseEntry can hold attachments, extensions, secret_refs", () => {
    const entry: DatabaseEntry = {
      name: "main",
      visible_schemas: ["main"],
      attachments: [{ alias: "lake", kind: "iceberg", uri: "s3://b" }],
      extensions: ["httpfs", "iceberg"],
      secret_refs: ["my_s3"],
    };
    expect(entry.attachments![0]!.alias).toBe("lake");
  });
});
