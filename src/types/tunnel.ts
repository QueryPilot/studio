import type { SshAuthMethod } from "./connection";

export interface AuthProfile {
  id: string;
  name: string;
  provider: AuthProvider;
  created_at: string;
}

export type AuthProvider =
  | {
      AzureAdSaml: {
        tenant_id: string;
        app_id_uri: string;
        default_username?: string;
        session_duration_hours: number;
        default_role_arn?: string;
      };
    }
  | {
      StaticAwsCredentials: {
        access_key_id: string;
        secret_access_key: string;
        region: string;
      };
    }
  | {
      EnvironmentAwsCredentials: {
        region?: string;
      };
    };

export interface TunnelProfile {
  id: string;
  name: string;
  tunnel_type: TunnelType;
  auth_profile_id?: string;
  created_at: string;
}

export type TunnelType =
  | {
      SshTunnel: {
        host: string;
        port: number;
        user: string;
        auth: SshAuthMethod;
      };
    }
  | {
      SsmBastion: {
        cluster_name?: string;
        task_definition?: string;
        region: string;
      };
    };

export interface InlineTunnelConfig {
  tunnel_type: TunnelType;
  auth_profile_id?: string;
}

/** Identify which provider variant an AuthProfile uses */
export function getProviderType(
  provider: AuthProvider
): "AzureAdSaml" | "StaticAwsCredentials" | "EnvironmentAwsCredentials" {
  if ("AzureAdSaml" in provider) return "AzureAdSaml";
  if ("StaticAwsCredentials" in provider) return "StaticAwsCredentials";
  return "EnvironmentAwsCredentials";
}

/** Identify which tunnel type variant a TunnelProfile uses */
export function getTunnelTypeKey(
  tunnelType: TunnelType
): "SshTunnel" | "SsmBastion" {
  if ("SshTunnel" in tunnelType) return "SshTunnel";
  return "SsmBastion";
}
