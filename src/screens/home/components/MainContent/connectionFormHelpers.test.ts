import { describe, expect, it } from "vitest";

import {
  extractConnectionErrorMessage,
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
});
