import { SslMode } from "@/types/connection";

export type ConnectionFormat = "uri" | "env" | "unknown";
export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "mssql"
  | "mongodb"
  | "redis";

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
  options?: Record<string, string>;
}

const SQLITE_PATH_PATTERN =
  /^(?:\/|\.\/|\.\.\/|~\/|[a-zA-Z]:[\\/]).+\.(db|sqlite|sqlite3|db3)(?:\?.*)?$/i;

function looksLikeSqlitePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^:memory:$/i.test(trimmed)) return true;
  return SQLITE_PATH_PATTERN.test(trimmed);
}

function looksLikeConnectionUri(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^jdbc:/i.test(trimmed)) return true;
  if (/^(postgres|postgresql|mysql|mariadb|mssql|sqlserver|sqlite):\/\//i.test(trimmed)) {
    return true;
  }
  if (/^(postgres|postgresql|mysql|mariadb|mssql|sqlserver|sqlite):/i.test(trimmed)) {
    return true;
  }
  // MongoDB URIs (standard and SRV format for Atlas)
  if (/^mongodb(\+srv)?:\/\//i.test(trimmed)) {
    return true;
  }
  // Redis URIs (standard and TLS)
  if (/^rediss?:\/\//i.test(trimmed)) {
    return true;
  }
  if (/^(server|data source|address|addr|network address)\s*=/i.test(trimmed)) {
    return true;
  }
  if (looksLikeSqlitePath(trimmed)) return true;

  return false;
}

/**
 * Detects the format of connection configuration text
 * @param text - The text to analyze
 * @returns The detected format type
 */
export function detectConnectionFormat(text: string): ConnectionFormat {
  const trimmed = text.trim();

  // Check for URI format (starts with protocol://)
  if (looksLikeConnectionUri(trimmed)) {
    return "uri";
  }

  // Check for env format (KEY=VALUE pairs)
  const lines = trimmed.split("\n").filter((line) => {
    const l = line.trim();
    return l && !l.startsWith("#");
  });

  const envPattern = /^(export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*.+$/i;
  const envLines = lines.filter((line) => envPattern.test(line));

  // Accept single-line env if it contains a database URL or connection info
  if (envLines.length >= 1) {
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

  // Detect database type from DB_CONNECTION, DB_DRIVER, etc.
  const dbConnection = getValue(
    "DB_CONNECTION",
    "DB_DRIVER",
    "DB_TYPE",
    "DATABASE_DRIVER",
    "DATABASE_TYPE",
    "CONNECTION",
    "DRIVER",
  );
  if (dbConnection) {
    const connLower = dbConnection.toLowerCase();
    if (
      connLower === "pgsql" ||
      connLower === "postgres" ||
      connLower === "postgresql" ||
      connLower === "pg"
    ) {
      config.dbType = "postgresql";
    } else if (connLower === "mysql" || connLower === "mysql2") {
      config.dbType = "mysql";
    } else if (connLower === "mariadb") {
      config.dbType = "mariadb";
    } else if (
      connLower === "mssql" ||
      connLower === "sqlserver" ||
      connLower === "sqlsrv" ||
      connLower === "sql_server" ||
      connLower === "odbc"
    ) {
      config.dbType = "mssql";
    } else if (connLower === "sqlite" || connLower === "sqlite3") {
      config.dbType = "sqlite";
    } else if (connLower === "mongodb" || connLower === "mongo") {
      config.dbType = "mongodb";
    } else if (connLower === "redis") {
      config.dbType = "redis";
    }
  } else if (hasPrefix("POSTGRES_") || hasPrefix("PG_") || hasPrefix("PGHOST")) {
    config.dbType = "postgresql";
  } else if (hasPrefix("MYSQL_")) {
    config.dbType = "mysql";
  } else if (hasPrefix("MARIADB_")) {
    config.dbType = "mariadb";
  } else if (hasPrefix("MSSQL_") || hasPrefix("SQLSERVER_") || hasPrefix("SQL_SERVER_")) {
    config.dbType = "mssql";
  } else if (hasPrefix("SQLITE_")) {
    config.dbType = "sqlite";
  } else if (hasPrefix("MONGO_") || hasPrefix("MONGODB_")) {
    config.dbType = "mongodb";
  } else if (hasPrefix("REDIS_")) {
    config.dbType = "redis";
  }

  // Map environment variables to config fields
  // Host patterns: Laravel, Docker, Heroku, generic
  config.host = getValue(
    // PostgreSQL
    "POSTGRES_HOST",
    "PGHOST",
    "PG_HOST",
    // MySQL/MariaDB
    "MYSQL_HOST",
    "MARIADB_HOST",
    // SQL Server
    "MSSQL_HOST",
    "SQLSERVER_HOST",
    "SQL_SERVER_HOST",
    // MongoDB
    "MONGODB_HOST",
    "MONGO_HOST",
    // Redis
    "REDIS_HOST",
    // Generic (Laravel, Rails, etc.)
    "DB_HOST",
    "DATABASE_HOST",
    "DB_SERVER",
    "DATABASE_SERVER",
    "HOST",
    "HOSTNAME",
    "SERVER",
  );

  // Port patterns
  config.port = getValue(
    // PostgreSQL
    "POSTGRES_PORT",
    "PGPORT",
    "PG_PORT",
    // MySQL/MariaDB
    "MYSQL_PORT",
    "MYSQL_TCP_PORT",
    "MARIADB_PORT",
    // SQL Server
    "MSSQL_PORT",
    "SQLSERVER_PORT",
    "SQL_SERVER_PORT",
    // MongoDB
    "MONGODB_PORT",
    "MONGO_PORT",
    // Redis
    "REDIS_PORT",
    // Generic
    "DB_PORT",
    "DATABASE_PORT",
    "PORT",
  );

  // Username patterns
  config.username = getValue(
    // PostgreSQL
    "POSTGRES_USER",
    "POSTGRES_USERNAME",
    "PGUSER",
    "PG_USER",
    // MySQL/MariaDB (also root user)
    "MYSQL_USER",
    "MYSQL_USERNAME",
    "MARIADB_USER",
    "MARIADB_USERNAME",
    // SQL Server
    "MSSQL_USER",
    "MSSQL_USERNAME",
    "SQLSERVER_USER",
    "SQL_SERVER_USER",
    "SA_USER",
    // MongoDB
    "MONGODB_USER",
    "MONGODB_USERNAME",
    "MONGO_USER",
    "MONGO_USERNAME",
    "MONGO_INITDB_ROOT_USERNAME",
    // Redis
    "REDIS_USER",
    "REDIS_USERNAME",
    // Generic (Laravel, Rails, Django, etc.)
    "DB_USER",
    "DB_USERNAME",
    "DATABASE_USER",
    "DATABASE_USERNAME",
    "USER",
    "USERNAME",
  );

  // Password patterns
  config.password = getValue(
    // PostgreSQL
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
    "PG_PASSWORD",
    // MySQL/MariaDB (including root)
    "MYSQL_PASSWORD",
    "MYSQL_ROOT_PASSWORD",
    "MYSQL_PWD",
    "MARIADB_PASSWORD",
    "MARIADB_ROOT_PASSWORD",
    // SQL Server
    "MSSQL_PASSWORD",
    "MSSQL_SA_PASSWORD",
    "SQLSERVER_PASSWORD",
    "SQL_SERVER_PASSWORD",
    "SA_PASSWORD",
    // MongoDB
    "MONGODB_PASSWORD",
    "MONGO_PASSWORD",
    "MONGO_INITDB_ROOT_PASSWORD",
    // Redis
    "REDIS_PASSWORD",
    "REDIS_AUTH",
    // Generic (Laravel, Rails, Django, etc.)
    "DB_PASSWORD",
    "DB_PASS",
    "DB_PWD",
    "DATABASE_PASSWORD",
    "DATABASE_PASS",
    "PASSWORD",
    "PASS",
    "PWD",
  );

  // Database name patterns
  config.database = getValue(
    // PostgreSQL
    "POSTGRES_DB",
    "POSTGRES_DATABASE",
    "PGDATABASE",
    "PG_DATABASE",
    // MySQL/MariaDB
    "MYSQL_DATABASE",
    "MYSQL_DB",
    "MARIADB_DATABASE",
    "MARIADB_DB",
    // SQL Server
    "MSSQL_DATABASE",
    "MSSQL_DB",
    "SQLSERVER_DATABASE",
    "SQL_SERVER_DATABASE",
    // SQLite
    "SQLITE_DATABASE",
    "SQLITE_DB",
    "SQLITE_PATH",
    // MongoDB
    "MONGODB_DATABASE",
    "MONGODB_DB",
    "MONGO_DATABASE",
    "MONGO_DB",
    "MONGO_INITDB_DATABASE",
    // Redis
    "REDIS_DATABASE",
    "REDIS_DB",
    // Generic (Laravel, Rails, Django, etc.)
    "DB_DATABASE",
    "DB_NAME",
    "DB_SCHEMA",
    "DATABASE_NAME",
    "DATABASE",
    "DBNAME",
    "DB",
    "SCHEMA",
    "CATALOG",
  );

  // Handle DATABASE_URL as a full connection URI
  // Support: Rails, Heroku, Docker, Laravel, etc.
  const databaseUrl = getValue(
    // Generic
    "DATABASE_URL",
    "DB_URL",
    "CONNECTION_STRING",
    "CONNECTION_URL",
    "DSN",
    // PostgreSQL
    "POSTGRES_URL",
    "POSTGRESQL_URL",
    "PG_URL",
    "PGURL",
    // MySQL/MariaDB
    "MYSQL_URL",
    "MARIADB_URL",
    // SQL Server
    "MSSQL_URL",
    "SQLSERVER_URL",
    // MongoDB
    "MONGODB_URL",
    "MONGODB_URI",
    "MONGO_URL",
    "MONGO_URI",
    // Redis
    "REDIS_URL",
    "REDIS_URI",
    // Heroku-style addons
    "HEROKU_POSTGRESQL_URL",
    "CLEARDB_DATABASE_URL",
    "JAWSDB_URL",
    "JAWSDB_MARIA_URL",
    "REDISTOGO_URL",
    "REDISCLOUD_URL",
    "MONGOLAB_URI",
    "MONGODB_ADDON_URI",
  );
  if (databaseUrl && looksLikeConnectionUri(databaseUrl)) {
    try {
      const uriConfig = parseConnectionUri(databaseUrl);
      config.dbType = uriConfig.dbType;
      config.host = uriConfig.host;
      config.port = uriConfig.port;
      config.username = uriConfig.username;
      config.password = uriConfig.password;
      config.database = uriConfig.database;
      if (uriConfig.sslMode !== undefined) {
        config.sslMode = uriConfig.sslMode;
      }
      return config;
    } catch {
      // Fall through to manual parsing
    }
  }

  // SSL Mode
  const sslModeValue = getValue(
    // PostgreSQL
    "PGSSLMODE",
    "PG_SSLMODE",
    "POSTGRES_SSLMODE",
    "POSTGRES_SSL_MODE",
    // MySQL/MariaDB
    "MYSQL_SSL_MODE",
    "MYSQL_SSL",
    "MARIADB_SSL_MODE",
    // SQL Server
    "MSSQL_ENCRYPT",
    "MSSQL_SSL",
    // Generic
    "SSL_MODE",
    "SSLMODE",
    "DB_SSL",
    "DB_SSL_MODE",
    "DATABASE_SSL",
    "DATABASE_SSL_MODE",
    "SSL",
    "ENCRYPT",
  );
  if (sslModeValue) {
    switch (sslModeValue.toLowerCase()) {
      case "disable":
      case "disabled":
      case "false":
      case "off":
      case "no":
      case "0":
      case "none":
        config.sslMode = SslMode.Disable;
        break;
      case "require":
      case "required":
      case "true":
      case "on":
      case "yes":
      case "1":
      case "enable":
      case "enabled":
      case "prefer":
      case "allow":
        config.sslMode = SslMode.Require;
        break;
      case "verify-ca":
      case "verify_ca":
      case "verifyca":
        config.sslMode = SslMode.VerifyCa;
        break;
      case "verify-full":
      case "verify_full":
      case "verifyfull":
      case "strict":
        config.sslMode = SslMode.VerifyFull;
        break;
    }
  }

  // SSL Certificates
  config.sslKeyFile = getValue(
    "SSL_KEY_FILE",
    "SSL_KEY",
    "SSL_KEY_PATH",
    "PGSSLKEY",
    "PG_SSL_KEY",
    "DB_SSL_KEY",
    "DATABASE_SSL_KEY",
    "CLIENT_KEY",
    "CLIENT_KEY_FILE",
  );
  config.sslCertFile = getValue(
    "SSL_CERT_FILE",
    "SSL_CERT",
    "SSL_CERT_PATH",
    "PGSSLCERT",
    "PG_SSL_CERT",
    "DB_SSL_CERT",
    "DATABASE_SSL_CERT",
    "CLIENT_CERT",
    "CLIENT_CERT_FILE",
  );
  config.sslCAFile = getValue(
    "SSL_CA_FILE",
    "SSL_CA",
    "SSL_CA_PATH",
    "SSL_ROOT_CERT",
    "PGSSLROOTCERT",
    "PG_SSL_CA",
    "PG_SSL_ROOT_CERT",
    "DB_SSL_CA",
    "DATABASE_SSL_CA",
    "CA_CERT",
    "CA_CERT_FILE",
    "ROOT_CERT",
    "MYSQL_SSL_CA",
  );

  // SSH Tunnel (bastion/jump host)
  const sshHostValue = getValue(
    "SSH_HOST",
    "SSH_SERVER",
    "SSH_HOSTNAME",
    "BASTION_HOST",
    "JUMP_HOST",
    "DB_SSH_HOST",
  );
  const sshPortValue = getValue(
    "SSH_PORT",
    "BASTION_PORT",
    "JUMP_PORT",
    "DB_SSH_PORT",
  );
  const sshUserValue = getValue(
    "SSH_USER",
    "SSH_USERNAME",
    "BASTION_USER",
    "JUMP_USER",
    "DB_SSH_USER",
    "SSH_LOGIN",
  );
  const sshPasswordValue = getValue(
    "SSH_PASSWORD",
    "SSH_PASS",
    "SSH_PWD",
    "BASTION_PASSWORD",
    "JUMP_PASSWORD",
    "DB_SSH_PASSWORD",
  );
  const sshKeyValue = getValue(
    "SSH_KEY_PATH",
    "SSH_KEY",
    "SSH_KEY_FILE",
    "SSH_PRIVATE_KEY",
    "SSH_PRIVATE_KEY_PATH",
    "SSH_IDENTITY_FILE",
    "BASTION_KEY",
    "JUMP_KEY",
    "DB_SSH_KEY",
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

function stripWrappingQuotes(value: string): string {
  let cleaned = value.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

function splitSemicolonParts(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let braceDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      current += char;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      current += char;
      continue;
    }
    if (char === ";" && braceDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function parseKeyValuePairs(input: string): Array<{ key: string; value: string }> {
  const parts = splitSemicolonParts(input);
  const pairs: Array<{ key: string; value: string }> = [];
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!key) continue;
    pairs.push({ key, value: stripWrappingQuotes(rawValue) });
  }
  return pairs;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

function normalizeOptionKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]+/g, "_");
}

function parseSslModeValue(value: string): SslMode | undefined {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "disable":
    case "false":
    case "0":
    case "off":
    case "no":
      return SslMode.Disable;
    case "require":
    case "true":
    case "1":
    case "on":
    case "yes":
      return SslMode.Require;
    case "verify-ca":
    case "verify_ca":
    case "verifyca":
      return SslMode.VerifyCa;
    case "verify-full":
    case "verify_full":
    case "verifyfull":
      return SslMode.VerifyFull;
    default:
      return undefined;
  }
}

function parseSqlServerHost(value: string): {
  host?: string;
  port?: string;
  instanceName?: string;
} {
  let cleaned = value.trim();
  if (!cleaned) return {};
  cleaned = cleaned.replace(/^tcp:/i, "");

  const [serverPart, portPart] = cleaned.split(",", 2);
  const [hostPart, instancePart] = serverPart.split("\\", 2);

  return {
    host: hostPart?.trim() || undefined,
    port: portPart?.trim() || undefined,
    instanceName: instancePart?.trim() || undefined,
  };
}

function applyQueryParams(
  config: ParsedUriConfig,
  params: URLSearchParams,
): void {
  const options: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    const keyLower = key.toLowerCase();
    if (keyLower === "sslmode" || keyLower === "ssl_mode" || keyLower === "ssl") {
      const parsed = parseSslModeValue(value);
      if (parsed !== undefined) {
        config.sslMode = parsed;
      } else {
        options[key] = value;
      }
      continue;
    }
    if (["user", "username", "uid"].includes(keyLower)) {
      if (!config.username) config.username = value;
      continue;
    }
    if (["password", "pass", "pwd"].includes(keyLower)) {
      if (!config.password) config.password = value;
      continue;
    }
    if (["database", "db", "dbname", "databasename"].includes(keyLower)) {
      if (!config.database) config.database = value;
      continue;
    }
    if (["host", "hostname"].includes(keyLower)) {
      if (!config.host) config.host = value;
      continue;
    }
    if (keyLower === "port") {
      if (!config.port) config.port = value;
      continue;
    }
    options[key] = value;
  }

  if (Object.keys(options).length > 0) {
    config.options = options;
  }
}

function parseSqlServerKeyValueString(input: string): ParsedUriConfig | null {
  const pairs = parseKeyValuePairs(input);
  if (pairs.length === 0) return null;

  const config: ParsedUriConfig = { dbType: "mssql" };
  const options: Record<string, string> = {};

  for (const { key, value } of pairs) {
    const normalized = normalizeKey(key);
    switch (normalized) {
      case "server":
      case "datasource":
      case "addr":
      case "address":
      case "networkaddress": {
        const hostInfo = parseSqlServerHost(value);
        if (hostInfo.host) config.host = hostInfo.host;
        if (hostInfo.port) config.port = hostInfo.port;
        if (hostInfo.instanceName) {
          options.instance_name = hostInfo.instanceName;
        }
        break;
      }
      case "port":
        config.port = value;
        break;
      case "database":
      case "initialcatalog":
      case "databasename":
      case "dbname":
        config.database = value;
        break;
      case "userid":
      case "user":
      case "username":
      case "uid":
        config.username = value;
        break;
      case "password":
      case "pwd":
        config.password = value;
        break;
      case "applicationname":
      case "app":
        options.application_name = value;
        break;
      case "instancename":
      case "instance":
        options.instance_name = value;
        break;
      case "trustservercertificate":
      case "trustcert":
        options.trustservercertificate = value;
        break;
      case "trustedconnection":
      case "integratedsecurity":
        options.trusted_connection = value;
        break;
      case "encrypt": {
        const parsed = parseSslModeValue(value);
        if (parsed !== undefined) {
          config.sslMode = parsed;
        } else {
          options.encrypt = value;
        }
        break;
      }
      case "sslmode":
      case "ssl": {
        const parsed = parseSslModeValue(value);
        if (parsed !== undefined) {
          config.sslMode = parsed;
        } else {
          options.sslmode = value;
        }
        break;
      }
      default:
        options[normalizeOptionKey(key)] = value;
        break;
    }
  }

  if (Object.keys(options).length > 0) {
    config.options = options;
  }

  return config;
}

function parseMySqlDsn(input: string): ParsedUriConfig {
  const match = input.match(/^(mysql|mariadb):/i);
  if (!match) {
    throw new Error("Invalid MySQL DSN");
  }

  const protocol = match[1]?.toLowerCase();
  const config: ParsedUriConfig = {
    dbType: protocol === "mariadb" ? "mariadb" : "mysql",
  };
  const dsnBody = input.replace(/^(mysql|mariadb):/i, "");
  const pairs = parseKeyValuePairs(dsnBody);
  const options: Record<string, string> = {};

  for (const { key, value } of pairs) {
    const normalized = normalizeKey(key);
    switch (normalized) {
      case "host":
      case "hostname":
      case "server":
        config.host = value;
        break;
      case "port":
        config.port = value;
        break;
      case "dbname":
      case "database":
      case "db":
        config.database = value;
        break;
      case "user":
      case "username":
      case "uid":
        config.username = value;
        break;
      case "password":
      case "passwd":
      case "pwd":
        config.password = value;
        break;
      case "sslmode":
      case "ssl": {
        const parsed = parseSslModeValue(value);
        if (parsed !== undefined) {
          config.sslMode = parsed;
        } else {
          options.sslmode = value;
        }
        break;
      }
      default:
        options[normalizeOptionKey(key)] = value;
        break;
    }
  }

  if (Object.keys(options).length > 0) {
    config.options = options;
  }

  return config;
}

function parseMongoDbUri(uri: string): ParsedUriConfig {
  const config: ParsedUriConfig = { dbType: "mongodb" };

  const isSrv = /^mongodb\+srv:\/\//i.test(uri);
  const normalized = uri.replace(/^mongodb(\+srv)?:\/\//i, "");

  const splitResult = normalized.split("/");
  const authAndHosts = splitResult[0] ?? "";
  const pathAndQuery = splitResult.slice(1).join("/");

  let authPart = "";
  let hostsPart = authAndHosts;

  if (authAndHosts.includes("@")) {
    const atIndex = authAndHosts.lastIndexOf("@");
    authPart = authAndHosts.slice(0, atIndex);
    hostsPart = authAndHosts.slice(atIndex + 1);
  }

  if (authPart) {
    const colonIndex = authPart.indexOf(":");
    if (colonIndex !== -1) {
      config.username = decodeURIComponent(authPart.slice(0, colonIndex));
      config.password = decodeURIComponent(authPart.slice(colonIndex + 1));
    } else {
      config.username = decodeURIComponent(authPart);
    }
  }

  const hostsList = hostsPart.split(",");
  if (hostsList.length > 0 && hostsList[0]) {
    const firstHost = hostsList[0];
    const bracketMatch = firstHost.match(/^\[([^\]]+)\]:(\d+)$/);
    if (bracketMatch) {
      config.host = bracketMatch[1];
      config.port = bracketMatch[2];
    } else {
      const [h, p] = firstHost.split(":");
      config.host = h;
      if (p && !isSrv) {
        config.port = p;
      }
    }
  }

  const [dbPath, queryString] = pathAndQuery.split("?");
  if (dbPath) {
    config.database = decodeURIComponent(dbPath);
  }

  if (queryString) {
    const params = new URLSearchParams(queryString);
    const options: Record<string, string> = {};

    for (const [key, value] of params.entries()) {
      const keyLower = key.toLowerCase();
      if (keyLower === "authsource") {
        options.authSource = value;
      } else if (keyLower === "replicaset") {
        options.replicaSet = value;
      } else if (keyLower === "ssl" || keyLower === "tls") {
        const boolVal = value.toLowerCase();
        if (boolVal === "true" || boolVal === "1") {
          config.sslMode = SslMode.Require;
        } else if (boolVal === "false" || boolVal === "0") {
          config.sslMode = SslMode.Disable;
        } else {
          options[key] = value;
        }
      } else {
        options[key] = value;
      }
    }

    if (hostsList.length > 1) {
      options.hosts = hostsList.join(",");
    }

    if (isSrv) {
      options.srv = "true";
    }

    if (Object.keys(options).length > 0) {
      config.options = options;
    }
  } else {
    const options: Record<string, string> = {};
    if (hostsList.length > 1) {
      options.hosts = hostsList.join(",");
    }
    if (isSrv) {
      options.srv = "true";
    }
    if (Object.keys(options).length > 0) {
      config.options = options;
    }
  }

  return config;
}

function parseRedisUri(uri: string): ParsedUriConfig {
  const config: ParsedUriConfig = { dbType: "redis" };

  const isTls = /^rediss:\/\//i.test(uri);
  if (isTls) {
    config.sslMode = SslMode.Require;
  }

  const normalized = uri.replace(/^rediss?:\/\//i, "");

  const splitResult = normalized.split("/");
  const authAndHost = splitResult[0] ?? "";
  const pathAndQuery = splitResult.slice(1).join("/");

  let authPart = "";
  let hostPart = authAndHost;

  if (authAndHost.includes("@")) {
    const atIndex = authAndHost.lastIndexOf("@");
    authPart = authAndHost.slice(0, atIndex);
    hostPart = authAndHost.slice(atIndex + 1);
  }

  if (authPart) {
    const colonIndex = authPart.indexOf(":");
    if (colonIndex === 0) {
      config.password = decodeURIComponent(authPart.slice(1));
    } else if (colonIndex !== -1) {
      config.username = decodeURIComponent(authPart.slice(0, colonIndex));
      config.password = decodeURIComponent(authPart.slice(colonIndex + 1));
    } else {
      config.username = decodeURIComponent(authPart);
    }
  }

  if (hostPart) {
    const bracketMatch = hostPart.match(/^\[([^\]]+)\]:(\d+)$/);
    if (bracketMatch) {
      config.host = bracketMatch[1];
      config.port = bracketMatch[2];
    } else {
      const [h, p] = hostPart.split(":");
      config.host = h || "localhost";
      if (p) config.port = p;
    }
  }

  const [dbPath, queryString] = pathAndQuery.split("?");
  if (dbPath) {
    config.database = dbPath;
  }

  if (queryString) {
    const params = new URLSearchParams(queryString);
    applyQueryParams(config, params);
  }

  return config;
}

function parseSqliteUri(input: string): ParsedUriConfig {
  let trimmed = input.trim();
  if (/^sqlite:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^sqlite:/i, "");
  }

  const splitResult = trimmed.split("?", 2);
  let path = splitResult[0] ?? "";
  const queryPart = splitResult[1];
  
  if (path.startsWith("//")) {
    path = path.slice(2);
  }

  if (path.startsWith("/") && /^[a-zA-Z]:\//.test(path.slice(1))) {
    path = path.slice(1);
  }

  if (path.replace(/^\/+/, "") === ":memory:") {
    path = ":memory:";
  }

  const config: ParsedUriConfig = {
    dbType: "sqlite",
    database: path,
  };

  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const options: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      options[key] = value;
    }
    if (Object.keys(options).length > 0) {
      config.options = options;
    }
  }

  return config;
}

/**
 * Pre-process URI to encode special characters in password that break URL parsing.
 * Handles common case where password contains unencoded #, ?, or @ characters.
 */
function preprocessUri(uri: string): string {
  // Match: protocol://user:password@host...
  // We need to find and encode the password portion
  const match = uri.match(/^([a-z][a-z0-9+.-]*:\/\/)([^:@]+):([^@]+)@(.+)$/i);
  if (!match) return uri;

  const [, protocol, username, password, rest] = match;

  // Encode special characters in password that break URL parsing
  const encodedPassword = password
    .replace(/%/g, '%25')  // Encode % first to avoid double-encoding
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/@/g, '%40');

  return `${protocol}${username}:${encodedPassword}@${rest}`;
}

function parseStandardUrl(uri: string): ParsedUriConfig {
  const processedUri = preprocessUri(uri);
  const url = new URL(processedUri);
  const protocol = url.protocol.replace(":", "").toLowerCase();

  let dbType: DatabaseType;
  if (protocol === "postgres" || protocol === "postgresql") {
    dbType = "postgresql";
  } else if (protocol === "mysql" || protocol === "mariadb") {
    dbType = protocol === "mariadb" ? "mariadb" : "mysql";
  } else if (protocol === "mssql" || protocol === "sqlserver") {
    dbType = "mssql";
  } else if (protocol === "mongodb" || protocol === "mongodb+srv") {
    dbType = "mongodb";
  } else if (protocol === "redis" || protocol === "rediss") {
    dbType = "redis";
  } else {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }

  const config: ParsedUriConfig = { dbType };

  if (url.hostname) config.host = url.hostname;
  if (url.port) config.port = url.port;
  if (url.username) config.username = decodeURIComponent(url.username);
  if (url.password) config.password = decodeURIComponent(url.password);
  if (url.pathname && url.pathname !== "/") {
    config.database = decodeURIComponent(url.pathname.substring(1));
  }

  applyQueryParams(config, url.searchParams);

  return config;
}

/**
 * Parses a connection URI
 * @param uri - Connection URI string
 * @returns Parsed configuration object
 * @throws Error if URI is invalid
 */
export function parseConnectionUri(uri: string): ParsedUriConfig {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new Error("Invalid URI");
  }

  if (/^jdbc:/i.test(trimmed)) {
    return parseConnectionUri(trimmed.replace(/^jdbc:/i, ""));
  }

  if (/^(server|data source|address|addr|network address)\s*=/i.test(trimmed)) {
    const parsed = parseSqlServerKeyValueString(trimmed);
    if (parsed) return parsed;
  }

  if (/^(mysql|mariadb):/i.test(trimmed) && !/^(mysql|mariadb):\/\//i.test(trimmed)) {
    return parseMySqlDsn(trimmed);
  }

  if (/^sqlite:/i.test(trimmed) || looksLikeSqlitePath(trimmed)) {
    return parseSqliteUri(trimmed);
  }

  if (/^mongodb(\+srv)?:\/\//i.test(trimmed)) {
    return parseMongoDbUri(trimmed);
  }

  if (/^rediss?:\/\//i.test(trimmed)) {
    return parseRedisUri(trimmed);
  }

  if (/^(mssql|sqlserver):\/\//i.test(trimmed) && trimmed.includes(";")) {
    const firstSemi = trimmed.indexOf(";");
    const base = trimmed.slice(0, firstSemi);
    const params = trimmed.slice(firstSemi + 1);
    const config = parseStandardUrl(base);
    const pairs = parseKeyValuePairs(params);
    const options: Record<string, string> = {};

    for (const { key, value } of pairs) {
      const normalized = normalizeKey(key);
      switch (normalized) {
        case "databasename":
        case "database":
          config.database = value;
          break;
        case "user":
        case "userid":
        case "username":
          config.username = value;
          break;
        case "password":
        case "pwd":
          config.password = value;
          break;
        case "applicationname":
        case "app":
          options.application_name = value;
          break;
        case "instancename":
        case "instance":
          options.instance_name = value;
          break;
        case "trustservercertificate":
        case "trustcert":
          options.trustservercertificate = value;
          break;
        case "trustedconnection":
        case "integratedsecurity":
          options.trusted_connection = value;
          break;
        case "encrypt": {
          const parsed = parseSslModeValue(value);
          if (parsed !== undefined) {
            config.sslMode = parsed;
          } else {
            options.encrypt = value;
          }
          break;
        }
        default:
          options[normalizeOptionKey(key)] = value;
          break;
      }
    }

    if (Object.keys(options).length > 0) {
      config.options = options;
    }

    return config;
  }

  return parseStandardUrl(trimmed);
}
