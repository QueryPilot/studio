/**
 * SAML Authentication Service
 *
 * Handles Azure AD SAML authentication flow for ECS Bastion connections.
 * Opens a webview window for user authentication and captures the SAML response.
 */

import { logger } from "@/lib/logger";
import { isTauri } from "@/utils/tauri";
import type { AzureAdSamlConfig } from "@/types/connection";

export interface SamlRole {
  role_arn: string;
  principal_arn: string;
}

export interface SamlCredentials {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  expiration: string;
  role_arn: string;
}

export interface CredentialsStatus {
  has_credentials: boolean;
  is_valid: boolean;
  expiration_secs: number | null;
  seconds_until_expiration: number | null;
  role_arn: string | null;
}

/**
 * Generate Azure AD SAML login URL
 */
export async function getAzureAdLoginUrl(
  config: AzureAdSamlConfig
): Promise<string> {
  if (!isTauri()) {
    throw new Error("SAML authentication requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_azure_ad_login_url", { config });
}

/**
 * Get AWS SAML endpoints for interception
 */
export async function getAwsSamlEndpoints(): Promise<string[]> {
  if (!isTauri()) {
    throw new Error("SAML endpoints require Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("get_aws_saml_endpoints");
}

/**
 * Parse roles from SAML response
 */
export async function parseSamlRoles(
  samlResponse: string
): Promise<SamlRole[]> {
  if (!isTauri()) {
    throw new Error("SAML parsing requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SamlRole[]>("parse_saml_roles", { samlResponse });
}

/**
 * Exchange SAML assertion for AWS credentials
 */
export async function assumeRoleWithSaml(
  connectionId: string,
  samlResponse: string,
  roleArn: string,
  principalArn: string,
  durationHours: number,
  region: string
): Promise<SamlCredentials> {
  if (!isTauri()) {
    throw new Error("SAML authentication requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SamlCredentials>("assume_role_with_saml", {
    samlResponse,
    roleArn,
    principalArn,
    durationHours,
    region,
    connectionId,
  });
}

/**
 * Get cached credentials status
 */
export async function getCredentialsStatus(
  connectionId: string
): Promise<CredentialsStatus> {
  if (!isTauri()) {
    throw new Error("Credentials check requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CredentialsStatus>("get_aws_credentials_status", {
    connectionId,
  });
}

/**
 * Clear cached credentials
 */
export async function clearCredentials(connectionId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Credentials clear requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<void>("clear_aws_credentials", { connectionId });
}

/**
 * Open Azure AD SAML authentication window
 *
 * This uses the Rust backend to create a webview window with JavaScript injection
 * that intercepts form submissions to AWS SAML endpoints and captures the SAMLResponse.
 *
 * The flow:
 * 1. Rust creates a WebviewWindow with the Azure AD login URL
 * 2. An initialization script is injected that intercepts form submissions
 * 3. When the form posts to AWS SAML endpoints, the script captures the SAMLResponse
 * 4. The script emits a 'saml-response-captured' event with the response
 * 5. This function listens for that event and returns the SAML response
 */
export async function openSamlAuthWindow(
  config: AzureAdSamlConfig
): Promise<string> {
  if (!isTauri()) {
    throw new Error("SAML authentication requires Tauri");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  logger.info("[SAML] Opening auth window via Rust backend");

  return new Promise<string>((resolve, reject) => {
    let unlistenResponse: (() => void) | null = null;
    let resolved = false;

    const cleanup = () => {
      if (unlistenResponse) {
        unlistenResponse();
        unlistenResponse = null;
      }
    };

    const handleResolve = (samlResponse: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(samlResponse);
    };

    const handleReject = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    // Set up event listener for SAML response captured by the injected script
    listen<{ samlResponse: string; relayState: string }>(
      "saml-response-captured",
      (event) => {
        logger.info("[SAML] Received SAML response from injected script");
        handleResolve(event.payload.samlResponse);
      }
    )
      .then((unlisten) => {
        unlistenResponse = unlisten;

        // Call Rust to open the SAML auth window with script injection
        return invoke<void>("open_saml_auth_window", { config });
      })
      .then(() => {
        logger.info("[SAML] Auth window opened successfully");
        // Window is now open - user will authenticate via Azure AD
        // The injected script will capture the SAML response and emit the event
      })
      .catch((err: unknown) => {
        handleReject(
          err instanceof Error ? err : new Error(String(err))
        );
      });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        handleReject(new Error("Authentication timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * Full SAML authentication flow
 * Returns credentials after successful authentication
 */
export async function performSamlAuth(
  connectionId: string,
  config: AzureAdSamlConfig,
  region: string,
  onRoleSelection?: (roles: SamlRole[]) => Promise<SamlRole>
): Promise<SamlCredentials> {
  // Check for existing valid credentials
  const status = await getCredentialsStatus(connectionId);
  if (status.has_credentials && status.is_valid && status.role_arn) {
    // Convert expiration_secs to ISO string for display
    const expirationDate = status.expiration_secs
      ? new Date(status.expiration_secs * 1000).toISOString()
      : "";

    logger.info("[SAML] Using cached credentials", {
      roleArn: status.role_arn,
      expiresAt: expirationDate,
      secondsRemaining: status.seconds_until_expiration,
    });

    // Return cached credentials info (actual credentials are stored in keychain)
    // The backend will use them automatically
    return {
      access_key_id: "[cached]",
      secret_access_key: "[cached]",
      session_token: "[cached]",
      expiration: expirationDate,
      role_arn: status.role_arn,
    };
  }

  // Open auth window and get SAML response
  const samlResponse = await openSamlAuthWindow(config);

  // Parse roles from SAML response
  const roles = await parseSamlRoles(samlResponse);
  logger.info("[SAML] Available roles", { count: roles.length });

  if (roles.length === 0) {
    throw new Error("No AWS roles found in SAML response");
  }

  // Get first role (we know it exists since length > 0)
  const firstRole = roles[0];
  if (!firstRole) {
    throw new Error("No AWS roles found in SAML response");
  }

  // Select role
  let selectedRole: SamlRole;

  if (roles.length === 1) {
    selectedRole = firstRole;
  } else if (config.default_role_arn) {
    // Try to find the default role
    const defaultRole = roles.find(
      (r) => r.role_arn === config.default_role_arn
    );
    if (defaultRole) {
      selectedRole = defaultRole;
    } else if (onRoleSelection) {
      selectedRole = await onRoleSelection(roles);
    } else {
      // Use first role if no selection callback
      selectedRole = firstRole;
      logger.warn("[SAML] Default role not found, using first available", {
        defaultRoleArn: config.default_role_arn,
        selectedRoleArn: selectedRole.role_arn,
      });
    }
  } else if (onRoleSelection) {
    selectedRole = await onRoleSelection(roles);
  } else {
    // Use first role if no selection callback
    selectedRole = firstRole;
  }

  logger.info("[SAML] Selected role", { roleArn: selectedRole.role_arn });

  // Exchange SAML for credentials
  const durationHours = config.duration_hours || 1;
  const credentials = await assumeRoleWithSaml(
    connectionId,
    samlResponse,
    selectedRole.role_arn,
    selectedRole.principal_arn,
    durationHours,
    region
  );

  logger.info("[SAML] Credentials obtained", {
    roleArn: credentials.role_arn,
    expiration: credentials.expiration,
  });

  return credentials;
}
