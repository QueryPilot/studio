import { SslMode } from "@/types/connection";
import type { DatabaseType } from "@/utils/connectionParser";

export interface SslModeOption {
  value: SslMode;
  label: string;
}

const SSL_MODE_OPTIONS_BY_DB: Record<DatabaseType, SslModeOption[]> = {
  postgresql: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Allow, label: "Allow" },
    { value: SslMode.Prefer, label: "Prefer" },
    { value: SslMode.Require, label: "Require" },
    { value: SslMode.VerifyCa, label: "Verify CA" },
    { value: SslMode.VerifyFull, label: "Verify Full" },
  ],
  mysql: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Prefer, label: "Prefer" },
    { value: SslMode.Require, label: "Require" },
    { value: SslMode.VerifyCa, label: "Verify CA" },
    { value: SslMode.VerifyFull, label: "Verify Identity" },
  ],
  mariadb: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Prefer, label: "Prefer" },
    { value: SslMode.Require, label: "Require" },
    { value: SslMode.VerifyCa, label: "Verify CA" },
    { value: SslMode.VerifyFull, label: "Verify Identity" },
  ],
  mssql: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Prefer, label: "Prefer" },
    { value: SslMode.Require, label: "Require" },
  ],
  sqlite: [{ value: SslMode.Disable, label: "Disable" }],
  mongodb: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Require, label: "Require" },
  ],
  redis: [
    { value: SslMode.Disable, label: "Disable" },
    { value: SslMode.Require, label: "Require" },
  ],
};

export function getSslModeOptionsForDb(dbType: DatabaseType): SslModeOption[] {
  return SSL_MODE_OPTIONS_BY_DB[dbType];
}

export function normalizeSslModeForDb(
  dbType: DatabaseType,
  sslMode: SslMode,
): SslMode {
  const allowed = getSslModeOptionsForDb(dbType);
  if (allowed.some((option) => option.value === sslMode)) {
    return sslMode;
  }

  switch (dbType) {
    case "mysql":
    case "mariadb":
      if (sslMode === SslMode.Allow) return SslMode.Prefer;
      break;
    case "mssql":
      if (sslMode === SslMode.Allow) return SslMode.Prefer;
      if (sslMode === SslMode.VerifyCa || sslMode === SslMode.VerifyFull) {
        return SslMode.Require;
      }
      break;
    case "mongodb":
    case "redis":
      return sslMode === SslMode.Disable ? SslMode.Disable : SslMode.Require;
    case "sqlite":
      return SslMode.Disable;
    default:
      break;
  }

  return allowed[0]?.value ?? SslMode.Disable;
}

export function supportsSslKeyFiles(dbType: DatabaseType): boolean {
  return dbType === "postgresql" || dbType === "mysql" || dbType === "mariadb";
}

interface SshTunnelValidationInput {
  useSSH: boolean;
  sshHost: string;
  sshUser: string;
  sshPassword: string;
  useSSHAgent: boolean;
  useSSHKey: boolean;
  sshKeyPath: string;
}

export function validateSshTunnelInputs(
  input: SshTunnelValidationInput,
): string | null {
  if (!input.useSSH) return null;

  if (!input.sshHost.trim()) {
    return "Please provide SSH host";
  }

  if (input.useSSHKey && !input.sshKeyPath.trim()) {
    return "Please provide SSH private key path";
  }

  const hasPassword = input.sshPassword.trim().length > 0;
  if (!hasPassword && !input.useSSHAgent && !input.useSSHKey) {
    return "Choose an SSH auth method: enter password, enable SSH Agent, or enable SSH Key.";
  }

  return null;
}

interface SslValidationInput {
  dbType?: DatabaseType;
  sslMode: SslMode;
  sslKeyFile: string;
  sslCertFile: string;
  sslCAFile: string;
}

export function validateSslInputs(input: SslValidationInput): string | null {
  if (input.sslMode === SslMode.Disable) return null;
  const dbType = input.dbType ?? "postgresql";
  if (!supportsSslKeyFiles(dbType)) return null;

  const hasKey = input.sslKeyFile.trim().length > 0;
  const hasCert = input.sslCertFile.trim().length > 0;
  const hasCA = input.sslCAFile.trim().length > 0;

  if (hasKey !== hasCert) {
    return "Provide both SSL key and SSL cert, or leave both empty.";
  }

  if (
    (input.sslMode === SslMode.VerifyCa ||
      input.sslMode === SslMode.VerifyFull) &&
    !hasCA
  ) {
    return "SSL CA cert is required for Verify CA/Verify Full modes.";
  }

  return null;
}

function extractMessageFromObject(error: object): string | null {
  if ("message" in error && typeof error.message === "string") {
    const message = error.message.trim();
    if (message) return message;
  }

  return null;
}

export function extractConnectionErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (!trimmed) return fallback;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const extracted = extractMessageFromObject(parsed);
        if (extracted) return extracted;
      }
    } catch {
      // Not a JSON payload, use raw string.
    }

    return trimmed;
  }

  if (error && typeof error === "object") {
    const extracted = extractMessageFromObject(error);
    if (extracted) return extracted;

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Ignore serialization issues and use fallback.
    }
  }

  return fallback;
}
