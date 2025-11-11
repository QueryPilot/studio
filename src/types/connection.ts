// Connection Profile matching Rust backend
export interface ConnectionProfile {
  id: string;
  name: string;
  db_type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl_mode?: SslMode;
  ssl_config?: SslConfig;
  ssh_tunnel?: SshTunnelConfig;
  bastion?: BastionConfig;
  options: Record<string, string>;
}

export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  SQLite = "SQLite",
  SQLServer = "SQLServer",
}

export enum SslMode {
  Disable = "Disable",
  Require = "Require",
  VerifyCa = "VerifyCa",
  VerifyFull = "VerifyFull",
}

export interface SslConfig {
  key_file?: string;
  cert_file?: string;
  ca_file?: string;
}

export interface SshTunnelConfig {
  host: string;
  port: number;
  user: string;
  auth: SshAuthMethod;
}

export type SshAuthMethod =
  | { Password: string }
  | { KeyFile: { path: string; passphrase?: string | null } }
  | { Agent: true };

export type BastionConfig =
  | { Ssh: SshTunnelConfig }
  | { AwsSsm: AwsSsmConfig };

export interface AwsSsmConfig {
  target_id: string;
  region: string;
  auth: AwsAuthMethod;
  remote_host: string;
  remote_port: number;
}

export type AwsAuthMethod =
  | { OAuthFederated: OAuthConfig }
  | { AwsProfile: { profile_name: string } }
  | { IamRole: { role_arn: string } }
  | { AccessKey: { access_key_id: string } };

export interface OAuthConfig {
  provider: OAuthProvider;
  client_id: string;
  tenant_id?: string;
  organization?: string;
  domain?: string;
  scopes: string[];
  assume_role_arn: string;
}

export type OAuthProvider =
  | "Microsoft"
  | "Google"
  | "Okta"
  | "Auth0"
  | "Keycloak"
  | { Generic: { name: string; auth_url: string; token_url: string; issuer: string } };

export interface StoredConnection {
  profile: ConnectionProfile;
  metadata: ConnectionMetadata;
}

export interface ConnectionMetadata {
  created_at: string;
  last_used: string | null;
  use_count: number;
  tags: string[];
  is_favorite: boolean;
}

export interface ActiveConnectionState {
  connection_id: string;
  connected_at: string;
}

export interface WindowStates {
  [windowLabel: string]: ActiveConnectionState;
}

export interface ConnectionChangedEvent {
  window: string;
  connection_id: string;
}

export interface ConnectionDeletedEvent {
  connection_id: string;
  affected_windows: string[];
}
