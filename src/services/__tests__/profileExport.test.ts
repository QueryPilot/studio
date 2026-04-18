import { describe, it, expect } from "vitest";
import { stripSecretsForExport, validateImportedProfile } from "@/services/profileExport";
import type { ConnectionProfile } from "@/types/connection";
import { DbType } from "@/types/connection";

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "conn-1",
    name: "DuckDB",
    db_type: DbType.DuckDB,
    host: "",
    port: 0,
    database: "/tmp/test.duckdb",
    username: "",
    options: {},
    databases: [
      {
        name: "main",
        visible_schemas: ["main"],
        secret_refs: ["my_s3"],
        attachments: [
          {
            alias: "lake",
            kind: "iceberg",
            uri: "s3://b/ice",
            secret_ref: "my_s3",
          },
        ],
        extensions: ["iceberg"],
      },
    ],
    ...overrides,
  };
}

describe("stripSecretsForExport", () => {
  it("removes secret_refs and attachment.secret_ref from databases", () => {
    const profile = makeProfile();
    const exported = stripSecretsForExport(profile);

    const db0 = exported.databases[0];
    expect(db0?.secret_refs).toBeUndefined();
    expect(db0?.attachments?.[0]?.secret_ref).toBeUndefined();
    // Other fields preserved
    expect(db0?.attachments?.[0]?.alias).toBe("lake");
    expect(db0?.extensions).toEqual(["iceberg"]);
  });

  it("does not mutate the original profile", () => {
    const profile = makeProfile();
    stripSecretsForExport(profile);
    expect(profile.databases[0]?.secret_refs).toEqual(["my_s3"]);
  });
});

describe("validateImportedProfile", () => {
  it("returns warnings for missing secrets", () => {
    const profile = makeProfile();
    const { warnings } = validateImportedProfile(profile, []); // no secrets in vault
    expect(warnings).toHaveLength(2); // one for secret_refs, one for attachment
    expect(warnings.some((w) => w.includes("my_s3"))).toBe(true);
  });

  it("returns no warnings when all secrets are present", () => {
    const profile = makeProfile();
    const { warnings } = validateImportedProfile(profile, ["my_s3"]);
    expect(warnings).toHaveLength(0);
  });

  it("deduplicates warnings — same secret referenced twice only warns once", () => {
    const profile = makeProfile();
    // secret_refs and attachment.secret_ref both reference "my_s3"
    const { warnings } = validateImportedProfile(profile, []);
    // Both references produce a warning (they're different fields)
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.includes("my_s3"))).toBe(true);
  });
});
