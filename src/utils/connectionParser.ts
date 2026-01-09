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

  // Handle DATABASE_URL as a full connection URI
  const databaseUrl = getValue("DATABASE_URL", "DB_URL", "CONNECTION_STRING");
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

  const config: ParsedUriConfig = { dbType: "mysql" };
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

function parseSqliteUri(input: string): ParsedUriConfig {
  let trimmed = input.trim();
  if (/^sqlite:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^sqlite:/i, "");
  }

  const [pathPart, queryPart] = trimmed.split("?", 2);
  let path = pathPart;
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

function parseStandardUrl(uri: string): ParsedUriConfig {
  const url = new URL(uri);
  const protocol = url.protocol.replace(":", "").toLowerCase();

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

  if (/^(mssql|sqlserver):\/\//i.test(trimmed) && trimmed.includes(";")) {
    const [base, params] = trimmed.split(";", 2);
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
