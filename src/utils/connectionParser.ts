import { SslMode } from "@/types/connection";

export type ConnectionFormat = "uri" | "env" | "unknown";
export type DatabaseType = "postgresql" | "mysql" | "sqlite" | "mssql";

export interface ParsedEnvConfig {
  dbType?: DatabaseType;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  sslMode?: SslMode;
  sslKeyFile?: string;
  sslCertFile?: string;
  sslCAFile?: string;
  sshHost?: string;
  sshPort?: string;
  sshUser?: string;
  sshPassword?: string;
  sshKeyPath?: string;
  useSSH?: boolean;
  useSSHKey?: boolean;
}

export interface ParsedUriConfig {
  dbType: DatabaseType;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  sslMode?: SslMode;
}

/**
 * Detects the format of connection configuration text
 * @param text - The text to analyze
 * @returns The detected format type
 */
export function detectConnectionFormat(text: string): ConnectionFormat {
  const trimmed = text.trim();

  // Check for URI format (contains protocol://)
  if (trimmed.includes("://")) {
    return "uri";
  }

  // Check for env format (multiple KEY=VALUE pairs)
  const lines = trimmed.split("\n").filter((line) => {
    const l = line.trim();
    return l && !l.startsWith("#");
  });

  const envPattern = /^(export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*.+$/i;
  const envLines = lines.filter((line) => envPattern.test(line));

  if (envLines.length >= 2) {
    return "env";
  }

  return "unknown";
}

/**
 * Parses environment variable style configuration
 * @param text - Environment variables text (KEY=VALUE format)
 * @returns Parsed configuration object
 * @throws Error if parsing fails
 */
export function parseConnectionEnv(text: string): ParsedEnvConfig {
  const lines = text.split("\n");
  const envVars: Record<string, string> = {};

  // Parse key=value pairs
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Remove 'export ' prefix if present
    const cleaned = trimmed.replace(/^export\s+/, "");

    // Match KEY=VALUE pattern
    const match = cleaned.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/i);
    if (!match || !match[1] || !match[2]) continue;

    const key = match[1];
    const rawValue = match[2];

    // Remove quotes from value
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    envVars[key.toUpperCase()] = value;
  }

  // Helper function to get value by trying multiple key variations
  const getValue = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      if (envVars[key.toUpperCase()]) {
        return envVars[key.toUpperCase()];
      }
    }
    return undefined;
  };

  // Helper function to check if any key starts with a prefix
  const hasPrefix = (prefix: string) =>
    Object.keys(envVars).some((k) => k.startsWith(prefix));

  const config: ParsedEnvConfig = {};

  // Detect database type from variable prefixes
  if (hasPrefix("POSTGRES_") || hasPrefix("PG")) {
    config.dbType = "postgresql";
  } else if (hasPrefix("MYSQL_")) {
    config.dbType = "mysql";
  } else if (hasPrefix("MSSQL_") || hasPrefix("SQLSERVER_")) {
    config.dbType = "mssql";
  } else if (hasPrefix("SQLITE_")) {
    config.dbType = "sqlite";
  }

  // Map environment variables to config fields
  config.host = getValue(
    "POSTGRES_HOST",
    "PGHOST",
    "MYSQL_HOST",
    "MSSQL_HOST",
    "DB_HOST",
    "DATABASE_HOST",
    "HOST",
  );

  config.port = getValue(
    "POSTGRES_PORT",
    "PGPORT",
    "MYSQL_PORT",
    "MSSQL_PORT",
    "DB_PORT",
    "DATABASE_PORT",
    "PORT",
  );

  config.username = getValue(
    "POSTGRES_USER",
    "PGUSER",
    "MYSQL_USER",
    "MSSQL_USER",
    "DB_USER",
    "DATABASE_USER",
    "USER",
    "USERNAME",
  );

  config.password = getValue(
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
    "MYSQL_PASSWORD",
    "MSSQL_PASSWORD",
    "DB_PASSWORD",
    "DATABASE_PASSWORD",
    "PASSWORD",
    "PASS",
  );

  config.database = getValue(
    "POSTGRES_DB",
    "PGDATABASE",
    "MYSQL_DATABASE",
    "MSSQL_DATABASE",
    "SQLITE_DATABASE",
    "SQLITE_DB",
    "DB_NAME",
    "DATABASE_NAME",
    "DATABASE",
    "DB",
  );

  // SSL Mode
  const sslModeValue = getValue(
    "SSL_MODE",
    "SSLMODE",
    "POSTGRES_SSLMODE",
    "DB_SSL",
  );
  if (sslModeValue) {
    switch (sslModeValue.toLowerCase()) {
      case "disable":
      case "false":
      case "0":
        config.sslMode = SslMode.Disable;
        break;
      case "require":
      case "true":
      case "1":
        config.sslMode = SslMode.Require;
        break;
      case "verify-ca":
      case "verify_ca":
        config.sslMode = SslMode.VerifyCa;
        break;
      case "verify-full":
      case "verify_full":
        config.sslMode = SslMode.VerifyFull;
        break;
    }
  }

  // SSL Certificates
  config.sslKeyFile = getValue("SSL_KEY_FILE", "SSL_KEY", "PGSSLKEY");
  config.sslCertFile = getValue("SSL_CERT_FILE", "SSL_CERT", "PGSSLCERT");
  config.sslCAFile = getValue("SSL_CA_FILE", "SSL_CA", "PGSSLROOTCERT");

  // SSH Tunnel
  const sshHostValue = getValue("SSH_HOST", "SSH_SERVER");
  const sshPortValue = getValue("SSH_PORT");
  const sshUserValue = getValue("SSH_USER", "SSH_USERNAME");
  const sshPasswordValue = getValue("SSH_PASSWORD", "SSH_PASS");
  const sshKeyValue = getValue(
    "SSH_KEY_PATH",
    "SSH_KEY",
    "SSH_PRIVATE_KEY",
  );

  if (sshHostValue || sshPortValue || sshUserValue) {
    config.useSSH = true;
    config.sshHost = sshHostValue;
    config.sshPort = sshPortValue;
    config.sshUser = sshUserValue;
    config.sshPassword = sshPasswordValue;
    if (sshKeyValue) {
      config.useSSHKey = true;
      config.sshKeyPath = sshKeyValue;
    }
  }

  return config;
}

/**
 * Parses a connection URI
 * @param uri - Connection URI string
 * @returns Parsed configuration object
 * @throws Error if URI is invalid
 */
export function parseConnectionUri(uri: string): ParsedUriConfig {
  // Handle SQLite special case
  if (uri.startsWith("sqlite://")) {
    const path = uri.replace(/^sqlite:\/\/\/?/, "");
    return {
      dbType: "sqlite",
      database: path,
    };
  }

  // Parse standard URI format
  const url = new URL(uri);
  const protocol = url.protocol.replace(":", "");

  // Determine database type from protocol
  let dbType: DatabaseType;
  if (protocol === "postgres" || protocol === "postgresql") {
    dbType = "postgresql";
  } else if (protocol === "mysql" || protocol === "mariadb") {
    dbType = "mysql";
  } else if (protocol === "mssql" || protocol === "sqlserver") {
    dbType = "mssql";
  } else {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }

  const config: ParsedUriConfig = { dbType };

  // Extract connection details
  if (url.hostname) config.host = url.hostname;
  if (url.port) config.port = url.port;
  if (url.username) config.username = decodeURIComponent(url.username);
  if (url.password) config.password = decodeURIComponent(url.password);
  if (url.pathname && url.pathname !== "/") {
    config.database = url.pathname.substring(1);
  }

  // Parse query parameters for SSL mode
  const params = url.searchParams;
  const sslModeParam = params.get("sslmode") || params.get("ssl");
  if (sslModeParam) {
    switch (sslModeParam.toLowerCase()) {
      case "disable":
      case "false":
        config.sslMode = SslMode.Disable;
        break;
      case "require":
      case "true":
        config.sslMode = SslMode.Require;
        break;
      case "verify-ca":
        config.sslMode = SslMode.VerifyCa;
        break;
      case "verify-full":
        config.sslMode = SslMode.VerifyFull;
        break;
    }
  }

  return config;
}
