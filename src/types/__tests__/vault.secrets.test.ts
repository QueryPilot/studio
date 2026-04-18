import { describe, it, expect } from "vitest";
import type { VaultData, VaultSecretRecord } from "@/types/vault";

describe("VaultSecretRecord", () => {
  it("is storable under VaultData.secrets", () => {
    const rec: VaultSecretRecord = {
      name: "my_s3",
      type: "s3",
      provider: "config",
      persistent: false,
      params: { KEY_ID: "AKIA", SECRET: "xxx", REGION: "us-east-1" },
      connection_id: "conn-1",
    };
    const vault: Partial<VaultData> = { secrets: [rec] };
    expect(vault.secrets![0]!.name).toBe("my_s3");
  });
});
