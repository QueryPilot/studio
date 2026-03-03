import { describe, expect, it } from "vitest";
import { SslMode } from "@/types/connection";

import {
  extractConnectionErrorMessage,
  getSslModeOptionsForDb,
  normalizeSslModeForDb,
  supportsSslKeyFiles,
  validateSslInputs,
  validateSshTunnelInputs,
} from "./connectionFormHelpers";

describe("connectionFormHelpers", () => {
  describe("validateSshTunnelInputs", () => {
    it("returns error when SSH is enabled without host", () => {
      const message = validateSshTunnelInputs({
        useSSH: true,
        sshHost: "",
        sshUser: "",
        sshPassword: "",
        useSSHAgent: false,
        useSSHKey: false,
        sshKeyPath: "",
      });

      expect(message).toBe("Please provide SSH host");
    });

    it("returns error when SSH key auth is selected without key path", () => {
      const message = validateSshTunnelInputs({
        useSSH: true,
        sshHost: "bastion.internal",
        sshUser: "deploy",
        sshPassword: "",
        useSSHAgent: false,
        useSSHKey: true,
        sshKeyPath: "",
      });

      expect(message).toBe("Please provide SSH private key path");
    });

    it("returns error when no auth method is provided", () => {
      const message = validateSshTunnelInputs({
        useSSH: true,
        sshHost: "bastion.internal",
        sshUser: "deploy",
        sshPassword: "",
        useSSHAgent: false,
        useSSHKey: false,
        sshKeyPath: "",
      });

      expect(message).toBe(
        "Choose an SSH auth method: enter password, enable SSH Agent, or enable SSH Key.",
      );
    });

    it("allows missing ssh user when agent auth is selected", () => {
      const message = validateSshTunnelInputs({
        useSSH: true,
        sshHost: "bastion-dev",
        sshUser: "",
        sshPassword: "",
        useSSHAgent: true,
        useSSHKey: false,
        sshKeyPath: "",
      });

      expect(message).toBeNull();
    });
  });

  describe("extractConnectionErrorMessage", () => {
    it("extracts message from Error", () => {
      expect(
        extractConnectionErrorMessage(new Error("SSH auth failed"), "fallback"),
      ).toBe("SSH auth failed");
    });

    it("extracts message from plain string", () => {
      expect(
        extractConnectionErrorMessage("Connection timeout", "fallback"),
      ).toBe("Connection timeout");
    });

    it("extracts message from JSON string payload", () => {
      expect(
        extractConnectionErrorMessage(
          '{"message":"SSH agent has no keys loaded"}',
          "fallback",
        ),
      ).toBe("SSH agent has no keys loaded");
    });

    it("extracts message from object payload", () => {
      expect(
        extractConnectionErrorMessage(
          { message: "SSH key file does not exist" },
          "fallback",
        ),
      ).toBe("SSH key file does not exist");
    });

    it("uses fallback when no useful detail exists", () => {
      expect(extractConnectionErrorMessage(null, "Connection failed")).toBe(
        "Connection failed",
      );
    });
  });

  describe("validateSslInputs", () => {
    it("returns no error when SSL mode is disabled", () => {
      const message = validateSslInputs({
        sslMode: SslMode.Disable,
        sslKeyFile: "",
        sslCertFile: "",
        sslCAFile: "",
      });

      expect(message).toBeNull();
    });

    it("requires both key and cert when either is provided", () => {
      const keyOnly = validateSslInputs({
        sslMode: SslMode.Require,
        sslKeyFile: "/tmp/client.key",
        sslCertFile: "",
        sslCAFile: "",
      });

      expect(keyOnly).toBe(
        "Provide both SSL key and SSL cert, or leave both empty.",
      );
    });

    it("requires CA cert for verify-ca and verify-full modes", () => {
      const verifyCa = validateSslInputs({
        sslMode: SslMode.VerifyCa,
        sslKeyFile: "",
        sslCertFile: "",
        sslCAFile: "",
      });

      const verifyFull = validateSslInputs({
        sslMode: SslMode.VerifyFull,
        sslKeyFile: "",
        sslCertFile: "",
        sslCAFile: "",
      });

      expect(verifyCa).toBe(
        "SSL CA cert is required for Verify CA/Verify Full modes.",
      );
      expect(verifyFull).toBe(
        "SSL CA cert is required for Verify CA/Verify Full modes.",
      );
    });

    it("allows allow/prefer modes without CA cert", () => {
      const allow = validateSslInputs({
        sslMode: SslMode.Allow,
        sslKeyFile: "",
        sslCertFile: "",
        sslCAFile: "",
      });

      const prefer = validateSslInputs({
        sslMode: SslMode.Prefer,
        sslKeyFile: "",
        sslCertFile: "",
        sslCAFile: "",
      });

      expect(allow).toBeNull();
      expect(prefer).toBeNull();
    });

    it("skips ssl key/cert validation for dialects without key file support", () => {
      const message = validateSslInputs({
        dbType: "mssql",
        sslMode: SslMode.VerifyCa,
        sslKeyFile: "/tmp/client.key",
        sslCertFile: "",
        sslCAFile: "",
      });

      expect(message).toBeNull();
    });
  });

  describe("getSslModeOptionsForDb", () => {
    it("returns full postgres ssl mode list", () => {
      const values = getSslModeOptionsForDb("postgresql").map((option) => option.value);
      expect(values).toEqual([
        SslMode.Disable,
        SslMode.Allow,
        SslMode.Prefer,
        SslMode.Require,
        SslMode.VerifyCa,
        SslMode.VerifyFull,
      ]);
    });

    it("returns dialect-specific mysql and mssql ssl mode lists", () => {
      const mysqlValues = getSslModeOptionsForDb("mysql").map((option) => option.value);
      const mssqlValues = getSslModeOptionsForDb("mssql").map((option) => option.value);

      expect(mysqlValues).toEqual([
        SslMode.Disable,
        SslMode.Prefer,
        SslMode.Require,
        SslMode.VerifyCa,
        SslMode.VerifyFull,
      ]);
      expect(mssqlValues).toEqual([
        SslMode.Disable,
        SslMode.Prefer,
        SslMode.Require,
      ]);
    });
  });

  describe("normalizeSslModeForDb", () => {
    it("maps unsupported modes to dialect-aware closest values", () => {
      expect(normalizeSslModeForDb("mssql", SslMode.VerifyFull)).toBe(
        SslMode.Require,
      );
      expect(normalizeSslModeForDb("mysql", SslMode.Allow)).toBe(
        SslMode.Prefer,
      );
      expect(normalizeSslModeForDb("postgresql", SslMode.VerifyFull)).toBe(
        SslMode.VerifyFull,
      );
    });
  });

  describe("supportsSslKeyFiles", () => {
    it("returns true only for postgresql/mysql/mariadb", () => {
      expect(supportsSslKeyFiles("postgresql")).toBe(true);
      expect(supportsSslKeyFiles("mysql")).toBe(true);
      expect(supportsSslKeyFiles("mariadb")).toBe(true);
      expect(supportsSslKeyFiles("mssql")).toBe(false);
      expect(supportsSslKeyFiles("mongodb")).toBe(false);
      expect(supportsSslKeyFiles("redis")).toBe(false);
      expect(supportsSslKeyFiles("sqlite")).toBe(false);
    });
  });
});
