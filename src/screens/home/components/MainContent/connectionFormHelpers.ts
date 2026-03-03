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
