import { describe, it, expect } from "vitest";
import { ConstraintType } from "@/services/backend";
import { chooseDeterministicIdentityColumns } from "../rowIdentity";

describe("chooseDeterministicIdentityColumns", () => {
  it("prefers primary keys over unique constraints and indexes", () => {
    const columns = chooseDeterministicIdentityColumns({
      primaryKeys: ["id"],
      constraints: [
        {
          name: "users_email_key",
          table_name: "users",
          constraint_type: ConstraintType.Unique,
          definition: 'UNIQUE ("email")',
        },
      ],
      indexes: [
        {
          name: "idx_users_username",
          table_name: "users",
          columns: ["username"],
          is_unique: true,
          is_primary: false,
          is_partial: false,
          definition: "",
          is_foreign_key: false,
        },
      ],
    });

    expect(columns).toEqual(["id"]);
  });

  it("falls back to unique constraints when no primary key exists", () => {
    const columns = chooseDeterministicIdentityColumns({
      primaryKeys: [],
      constraints: [
        {
          name: "users_email_key",
          table_name: "users",
          constraint_type: ConstraintType.Unique,
          definition: 'UNIQUE ("email")',
        },
      ],
      indexes: [],
    });

    expect(columns).toEqual(["email"]);
  });

  it("falls back to non-partial unique indexes when no PK/unique constraints exist", () => {
    const columns = chooseDeterministicIdentityColumns({
      primaryKeys: [],
      constraints: [],
      indexes: [
        {
          name: "idx_users_email_partial",
          table_name: "users",
          columns: ["email"],
          is_unique: true,
          is_primary: false,
          is_partial: true,
          definition: "",
          is_foreign_key: false,
        },
        {
          name: "idx_users_username",
          table_name: "users",
          columns: ["username"],
          is_unique: true,
          is_primary: false,
          is_partial: false,
          definition: "",
          is_foreign_key: false,
        },
      ],
    });

    expect(columns).toEqual(["username"]);
  });

  it("returns null when no deterministic candidate exists", () => {
    const columns = chooseDeterministicIdentityColumns({
      primaryKeys: [],
      constraints: [],
      indexes: [
        {
          name: "idx_users_name",
          table_name: "users",
          columns: ["name"],
          is_unique: false,
          is_primary: false,
          is_partial: false,
          definition: "",
          is_foreign_key: false,
        },
      ],
    });

    expect(columns).toBeNull();
  });
});
