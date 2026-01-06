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
  group?: string; // Optional group name for organizing related connections
  default_schema?: string; // Default schema for PostgreSQL/SQLServer (e.g., "myschema" instead of "public")
}

export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MariaDB = "MariaDB",
  SQLite = "SQLite",
  SQLServer = "SQLServer",
}

/**
 * Check if database type is MySQL-compatible (MySQL or MariaDB)
 */
export function isMySQLCompatible(dbType: DbType): boolean {
  return dbType === DbType.MySQL || dbType === DbType.MariaDB;
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
  | { AwsSsm: AwsSsmConfig }
  | { EcsBastion: EcsBastionConfig };

/**
 * ECS Bastion configuration for ephemeral Fargate-based bastion hosts
 * Launches an ECS task that registers with SSM, then SSH tunnels through it
 */
export interface EcsBastionConfig {
  /** ECS cluster name (e.g., "ecs-ssm-bastion-cluster") */
  cluster_name: string;
  /** ECS task definition name (e.g., "ecs-ssm-bastion") */
  task_definition: string;
  /** AWS region (e.g., "ap-southeast-2") */
  region: string;
  /** Authentication method for AWS API calls */
  auth: AwsAuthMethod;
  /** Target database host (internal VPC address) */
  remote_host: string;
  /** Target database port */
  remote_port: number;
  /** Optional: Subnet filter tags (e.g., ["private-a", "private-b"]) */
  subnet_tags?: string[];
  /** Optional: Security group tag key=value (e.g., "Bastion=SSM") */
  security_group_tag?: string;
  /** Optional: IAM role for the ECS task */
  task_role_name?: string;
}

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
  | { AccessKey: { access_key_id: string } }
  | { AzureAdSaml: AzureAdSamlConfig };

/**
 * Azure AD SAML configuration for AWS federated authentication
 */
export interface AzureAdSamlConfig {
  /** Azure AD tenant ID (e.g., "53c4eee7-df48-4119-b261-da130f3e1a32") */
  tenant_id: string;
  /** Azure App ID URI (e.g., "https://signin.aws.amazon.com/saml#2") */
  app_id_uri: string;
  /** Optional: Pre-selected IAM role ARN */
  default_role_arn?: string;
  /** Optional: Session duration in hours (1-12, default: 1) */
  duration_hours?: number;
}

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
