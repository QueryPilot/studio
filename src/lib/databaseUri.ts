export interface ParsedDatabaseUri {
  type: "postgresql" | "mysql" | "sqlite";
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  filePath?: string;
  options?: Record<string, string>;
}

export function parseDatabaseUri(uri: string): ParsedDatabaseUri | null {
  try {
    // Trim whitespace
    uri = uri.trim();
    
    // SQLite file path
    if (uri.startsWith("sqlite:") || uri.endsWith(".db") || uri.endsWith(".sqlite") || uri.endsWith(".sqlite3")) {
      const filePath = uri.replace(/^sqlite:\/\//, "").replace(/^sqlite:/, "");
      return {
        type: "sqlite",
        filePath,
      };
    }
    
    // PostgreSQL
    if (uri.startsWith("postgresql://") || uri.startsWith("postgres://")) {
      const url = new URL(uri.replace("postgres://", "postgresql://"));
      return {
        type: "postgresql",
        host: url.hostname || "localhost",
        port: url.port ? parseInt(url.port) : 5432,
        database: url.pathname.slice(1) || "postgres",
        username: url.username || undefined,
        password: url.password || undefined,
        ssl: url.searchParams.get("sslmode") !== "disable",
        options: Object.fromEntries(url.searchParams),
      };
    }
    
    // MySQL
    if (uri.startsWith("mysql://")) {
      const url = new URL(uri);
      return {
        type: "mysql",
        host: url.hostname || "localhost",
        port: url.port ? parseInt(url.port) : 3306,
        database: url.pathname.slice(1) || "mysql",
        username: url.username || undefined,
        password: url.password || undefined,
        ssl: url.searchParams.get("ssl") === "true",
        options: Object.fromEntries(url.searchParams),
      };
    }
    
    // MongoDB support removed - using secure backend architecture
    
    // Try to detect by common patterns
    if (uri.includes("@") && uri.includes(":")) {
      // Likely a connection string without protocol
      // Try to guess the type based on port or other hints
      const parts = uri.split("@");
      if (parts.length === 2) {
        const [credentials, hostInfo] = parts;
        const [username, password] = credentials?.split(":") || [];
        const [hostPort, ...dbParts] = hostInfo?.split("/") || [];
        const [host, port] = hostPort?.split(":") || [];
        const database = dbParts.join("/");
        
        // Guess type based on port
        const portNum = port ? parseInt(port) : 0;
        let type: ParsedDatabaseUri["type"] = "postgresql";
        
        if (portNum === 3306) type = "mysql";
        else if (portNum === 5432) type = "postgresql";
        // MongoDB removed - only PostgreSQL and MySQL supported
        
        return {
          type,
          host: host || "localhost",
          port: portNum || (type === "mysql" ? 3306 : 5432),
          database: database || undefined,
          username: username || undefined,
          password: password || undefined,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error("Failed to parse database URI:", error);
    return null;
  }
}

export function buildDatabaseUri(config: ParsedDatabaseUri): string {
  const { type, host, port, database, username, password, filePath, options } = config;
  
  if (type === "sqlite" && filePath) {
    return `sqlite:${filePath}`;
  }
  
  let protocol = "";
  let defaultPort = 0;
  
  switch (type) {
    case "postgresql":
      protocol = "postgresql://";
      defaultPort = 5432;
      break;
    case "mysql":
      protocol = "mysql://";
      defaultPort = 3306;
      break;
    // MongoDB removed - using secure backend architecture
  }
  
  let uri = protocol;
  
  if (username) {
    uri += username;
    if (password) {
      uri += `:${password}`;
    }
    uri += "@";
  }
  
  uri += host || "localhost";
  
  if (port && port !== defaultPort) {
    uri += `:${port}`;
  }
  
  if (database) {
    uri += `/${database}`;
  }
  
  if (options && Object.keys(options).length > 0) {
    const params = new URLSearchParams(options);
    uri += `?${params.toString()}`;
  }
  
  return uri;
}