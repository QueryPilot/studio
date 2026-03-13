import { describe, it, expect } from "vitest";
import {
  detectConnectionFormat,
  parseConnectionEnv,
  parseConnectionUri,
} from "./connectionParser";
import { SslMode } from "@/types/connection";

describe("connectionParser", () => {
  describe("detectConnectionFormat", () => {
    describe("URI format detection", () => {
      it("should detect PostgreSQL URI", () => {
        const uri = "postgresql://user:pass@localhost:5432/db";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect MySQL URI", () => {
        const uri = "mysql://root:password@localhost:3306/mydb";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect SQLite URI", () => {
        const uri = "sqlite:///path/to/database.db";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect SQL Server URI", () => {
        const uri = "mssql://sa:password@localhost:1433/master";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect JDBC URI", () => {
        const uri = "jdbc:postgresql://localhost:5432/db";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect SQL Server connection string", () => {
        const uri =
          "Server=localhost,1433;Database=master;User Id=sa;Password=Pass123;";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect MySQL DSN", () => {
        const uri = "mysql:host=localhost;port=3306;dbname=app";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect SQLite file path", () => {
        const uri = "./seeds/sqlite/query_pilot_test.db";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });

      it("should detect SQLite memory database", () => {
        const uri = "sqlite::memory:";
        expect(detectConnectionFormat(uri)).toBe("uri");
      });
    });

    describe("ENV format detection", () => {
      it("should detect basic env format", () => {
        const env = `DB_HOST=localhost
DB_PORT=5432
DB_USER=admin`;
        expect(detectConnectionFormat(env)).toBe("env");
      });

      it("should detect env format with export", () => {
        const env = `export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432`;
        expect(detectConnectionFormat(env)).toBe("env");
      });

      it("should detect env format with comments", () => {
        const env = `# Database config
POSTGRES_HOST=localhost
POSTGRES_PORT=5432`;
        expect(detectConnectionFormat(env)).toBe("env");
      });

      it("should detect env format with mixed case", () => {
        const env = `db_host=localhost
db_port=5432`;
        expect(detectConnectionFormat(env)).toBe("env");
      });

      it("should detect env format with quoted values", () => {
        const env = `DB_HOST="localhost"
DB_USER='admin'`;
        expect(detectConnectionFormat(env)).toBe("env");
      });
    });

    describe("unknown format detection", () => {
      it("should return env for single line KEY=VALUE", () => {
        expect(detectConnectionFormat("DB_HOST=localhost")).toBe("env");
      });

      it("should return unknown for empty string", () => {
        expect(detectConnectionFormat("")).toBe("unknown");
      });

      it("should return unknown for random text", () => {
        expect(detectConnectionFormat("random text")).toBe("unknown");
      });

      it("should return unknown for just comments", () => {
        const text = `# Just a comment
# Another comment`;
        expect(detectConnectionFormat(text)).toBe("unknown");
      });
    });
  });

  describe("parseConnectionEnv", () => {
    describe("PostgreSQL configurations", () => {
      it("should parse POSTGRES_ prefix variables", () => {
        const env = `POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=admin
POSTGRES_PASSWORD=secret
POSTGRES_DB=myapp`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("admin");
        expect(config.password).toBe("secret");
        expect(config.database).toBe("myapp");
      });

      it("should parse PG prefix variables", () => {
        const env = `PGHOST=db.example.com
PGPORT=5432
PGUSER=app_user
PGPASSWORD=secure_pass
PGDATABASE=production`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("db.example.com");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("app_user");
        expect(config.password).toBe("secure_pass");
        expect(config.database).toBe("production");
      });
    });

    describe("MySQL configurations", () => {
      it("should parse MYSQL_ prefix variables", () => {
        const env = `MYSQL_HOST=192.168.1.100
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=rootpass
MYSQL_DATABASE=ecommerce`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("mysql");
        expect(config.host).toBe("192.168.1.100");
        expect(config.port).toBe("3306");
        expect(config.username).toBe("root");
        expect(config.password).toBe("rootpass");
        expect(config.database).toBe("ecommerce");
      });
    });

    describe("SQL Server configurations", () => {
      it("should parse MSSQL_ prefix variables", () => {
        const env = `MSSQL_HOST=sqlserver.local
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=StrongPass123
MSSQL_DATABASE=master`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("mssql");
        expect(config.host).toBe("sqlserver.local");
        expect(config.port).toBe("1433");
        expect(config.username).toBe("sa");
        expect(config.password).toBe("StrongPass123");
        expect(config.database).toBe("master");
      });
    });

    describe("SQLite configurations", () => {
      it("should parse SQLITE_ prefix variables", () => {
        const env = `SQLITE_DATABASE=/path/to/database.db`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe("/path/to/database.db");
      });
    });

    describe("generic DB_ prefix", () => {
      it("should parse DB_ prefix variables", () => {
        const env = `DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=test_db`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("postgres");
        expect(config.password).toBe("password");
        expect(config.database).toBe("test_db");
      });
    });

    describe("custom-prefixed env vars", () => {
      it("should parse env vars with a custom team prefix", () => {
        const env = `PARTNER_DB_HOST=10.40.80.152
PARTNER_DB_PORT=5432
PARTNER_DB_USERNAME=k_sales
PARTNER_DB_PASSWORD=UAT_KAuth168Postgres!^*
PARTNER_DB_NAME=k_sales_cr02
PARTNER_DB_SSL_MODE=disable`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("10.40.80.152");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("k_sales");
        expect(config.password).toBe("UAT_KAuth168Postgres!^*");
        expect(config.database).toBe("k_sales_cr02");
        expect(config.sslMode).toBe(SslMode.Disable);
      });

      it("should parse env vars with app prefix on standard db keys", () => {
        const env = `MYAPP_POSTGRES_HOST=db.example.com
MYAPP_POSTGRES_PORT=5432
MYAPP_POSTGRES_USER=admin
MYAPP_POSTGRES_PASSWORD=secret
MYAPP_POSTGRES_DB=production`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("db.example.com");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("admin");
        expect(config.password).toBe("secret");
        expect(config.database).toBe("production");
      });

      it("should prefer exact match over prefixed match", () => {
        const env = `DB_HOST=exact-host
PARTNER_DB_HOST=prefixed-host
DB_PORT=5432`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("exact-host");
      });
    });

    describe("export statements", () => {
      it("should handle export prefix", () => {
        const env = `export DATABASE_HOST=localhost
export DATABASE_PORT=5432
export DATABASE_USER=myuser
export DATABASE_PASSWORD=mypass
export DATABASE_NAME=mydb`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("myuser");
        expect(config.password).toBe("mypass");
        expect(config.database).toBe("mydb");
      });
    });

    describe("DATABASE_URL support", () => {
      it("should parse DATABASE_URL with PostgreSQL URI", () => {
        const env = `DATABASE_URL=postgresql://user:pass@localhost:5432/mydb`;
        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("user");
        expect(config.password).toBe("pass");
        expect(config.database).toBe("mydb");
      });

      it("should parse DATABASE_URL with MySQL URI", () => {
        const env = `DATABASE_URL=mysql://admin:secret@db.example.com:3306/appdb`;
        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("mysql");
        expect(config.host).toBe("db.example.com");
        expect(config.port).toBe("3306");
        expect(config.username).toBe("admin");
        expect(config.password).toBe("secret");
        expect(config.database).toBe("appdb");
      });

      it("should parse DB_URL as alias", () => {
        const env = `DB_URL=postgres://user:pass@host:5432/db`;
        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("host");
      });
    });

    describe("quoted values", () => {
      it("should handle double-quoted values", () => {
        const env = `DB_HOST="localhost"
DB_PASSWORD="complex=pass!@#"`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("localhost");
        expect(config.password).toBe("complex=pass!@#");
      });

      it("should handle single-quoted values", () => {
        const env = `DB_USER='admin'
DB_PASSWORD='my password'`;

        const config = parseConnectionEnv(env);

        expect(config.username).toBe("admin");
        expect(config.password).toBe("my password");
      });
    });

    describe("comments and whitespace", () => {
      it("should ignore comments", () => {
        const env = `# Production Database
POSTGRES_HOST=prod-db.example.com
# Port configuration
POSTGRES_PORT=5432
POSTGRES_USER=prod_user`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("prod-db.example.com");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("prod_user");
      });

      it("should handle whitespace around equals", () => {
        const env = `DB_HOST = localhost
DB_PORT   =   5432
DB_USER=   admin`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("admin");
      });

      it("should skip empty lines", () => {
        const env = `DB_HOST=localhost

DB_PORT=5432

DB_USER=admin`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("admin");
      });

      it("should parse env text wrapped in markdown code fences", () => {
        const env = `\`\`\` DB_HOST=postgres-private
  DB_PORT=5432
  DB_USER=devuser
  DB_PASSWORD=devpass123
  DB_NAME=todoapp
  SSH_HOST=ssh-bastion-key\`\`\``;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("postgres-private");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("devuser");
        expect(config.password).toBe("devpass123");
        expect(config.database).toBe("todoapp");
        expect(config.sshHost).toBe("ssh-bastion-key");
      });
    });

    describe("SSL configuration", () => {
      it("should parse SSL mode", () => {
        const envDisable = `SSL_MODE=disable`;
        expect(parseConnectionEnv(envDisable).sslMode).toBe(SslMode.Disable);

        const envAllow = `SSL_MODE=allow`;
        expect(parseConnectionEnv(envAllow).sslMode).toBe(SslMode.Allow);

        const envPrefer = `SSLMODE=prefer`;
        expect(parseConnectionEnv(envPrefer).sslMode).toBe(SslMode.Prefer);

        const envRequire = `SSLMODE=require`;
        expect(parseConnectionEnv(envRequire).sslMode).toBe(SslMode.Require);

        const envVerifyCa = `SSL_MODE=verify-ca`;
        expect(parseConnectionEnv(envVerifyCa).sslMode).toBe(SslMode.VerifyCa);

        const envVerifyFull = `SSL_MODE=verify_full`;
        expect(parseConnectionEnv(envVerifyFull).sslMode).toBe(
          SslMode.VerifyFull,
        );
      });

      it("should parse SSL mode with boolean values", () => {
        const envFalse = `SSL_MODE=false`;
        expect(parseConnectionEnv(envFalse).sslMode).toBe(SslMode.Disable);

        const envTrue = `SSL_MODE=true`;
        expect(parseConnectionEnv(envTrue).sslMode).toBe(SslMode.Require);

        const envZero = `SSL_MODE=0`;
        expect(parseConnectionEnv(envZero).sslMode).toBe(SslMode.Disable);

        const envOne = `SSL_MODE=1`;
        expect(parseConnectionEnv(envOne).sslMode).toBe(SslMode.Require);
      });

      it("should parse SSL certificate files", () => {
        const env = `SSL_KEY_FILE=/path/to/key.pem
SSL_CERT_FILE=/path/to/cert.pem
SSL_CA_FILE=/path/to/ca.pem`;

        const config = parseConnectionEnv(env);

        expect(config.sslKeyFile).toBe("/path/to/key.pem");
        expect(config.sslCertFile).toBe("/path/to/cert.pem");
        expect(config.sslCAFile).toBe("/path/to/ca.pem");
      });

      it("should parse PostgreSQL SSL variables", () => {
        const env = `PGSSLKEY=/path/to/key.pem
PGSSLCERT=/path/to/cert.pem
PGSSLROOTCERT=/path/to/ca.pem`;

        const config = parseConnectionEnv(env);

        expect(config.sslKeyFile).toBe("/path/to/key.pem");
        expect(config.sslCertFile).toBe("/path/to/cert.pem");
        expect(config.sslCAFile).toBe("/path/to/ca.pem");
      });
    });

    describe("SSH tunnel configuration", () => {
      it("should parse SSH password auth", () => {
        const env = `SSH_HOST=bastion.example.com
SSH_PORT=22
SSH_USER=sshuser
SSH_PASSWORD=sshpass`;

        const config = parseConnectionEnv(env);

        expect(config.useSSH).toBe(true);
        expect(config.sshHost).toBe("bastion.example.com");
        expect(config.sshPort).toBe("22");
        expect(config.sshUser).toBe("sshuser");
        expect(config.sshPassword).toBe("sshpass");
      });

      it("should parse SSH key auth", () => {
        const env = `SSH_HOST=jump-server.com
SSH_PORT=22
SSH_USER=deployer
SSH_KEY_PATH=/home/user/.ssh/id_rsa`;

        const config = parseConnectionEnv(env);

        expect(config.useSSH).toBe(true);
        expect(config.sshHost).toBe("jump-server.com");
        expect(config.sshPort).toBe("22");
        expect(config.sshUser).toBe("deployer");
        expect(config.sshKeyPath).toBe("/home/user/.ssh/id_rsa");
        expect(config.useSSHKey).toBe(true);
      });

      it("should enable SSH when any SSH var is present", () => {
        const envHostOnly = `SSH_HOST=bastion.com`;
        expect(parseConnectionEnv(envHostOnly).useSSH).toBe(true);

        const envUserOnly = `SSH_USER=deployer`;
        expect(parseConnectionEnv(envUserOnly).useSSH).toBe(true);

        const envPortOnly = `SSH_PORT=2222`;
        expect(parseConnectionEnv(envPortOnly).useSSH).toBe(true);
      });
    });

    describe("case insensitivity", () => {
      it("should handle lowercase variable names", () => {
        const env = `postgres_host=localhost
postgres_port=5432`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
      });

      it("should handle mixed case variable names", () => {
        const env = `Postgres_Host=localhost
POSTGRES_PORT=5432
postgres_user=admin`;

        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("admin");
      });
    });

    describe("priority of variable names", () => {
      it("should prioritize database-specific variables over generic", () => {
        const env = `POSTGRES_HOST=postgres-server
DB_HOST=generic-server`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("postgres-server");
      });

      it("should use generic variables when specific not present", () => {
        const env = `DB_HOST=generic-server
DB_PORT=5432`;

        const config = parseConnectionEnv(env);

        expect(config.host).toBe("generic-server");
        expect(config.port).toBe("5432");
      });
    });

    describe("empty and minimal configurations", () => {
      it("should handle empty string", () => {
        const config = parseConnectionEnv("");
        expect(config).toEqual({});
      });

      it("should handle only comments", () => {
        const env = `# Just comments
# No actual config`;
        const config = parseConnectionEnv(env);
        expect(config).toEqual({});
      });

      it("should handle partial config", () => {
        const env = `POSTGRES_HOST=localhost`;
        const config = parseConnectionEnv(env);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBeUndefined();
        expect(config.username).toBeUndefined();
      });
    });
  });

  describe("parseConnectionUri", () => {
    describe("PostgreSQL URIs", () => {
      it("should parse basic PostgreSQL URI", () => {
        const uri = "postgresql://user:pass@localhost:5432/mydb";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("user");
        expect(config.password).toBe("pass");
        expect(config.database).toBe("mydb");
      });

      it("should handle postgres:// protocol", () => {
        const uri = "postgres://user:pass@localhost:5432/mydb";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("postgresql");
      });

      it("should handle URI without port", () => {
        const uri = "postgresql://user:pass@localhost/mydb";
        const config = parseConnectionUri(uri);

        expect(config.host).toBe("localhost");
        expect(config.port).toBeUndefined();
        expect(config.database).toBe("mydb");
      });

      it("should handle URI without database", () => {
        const uri = "postgresql://user:pass@localhost:5432";
        const config = parseConnectionUri(uri);

        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.database).toBeUndefined();
      });

      it("should handle URI with SSL mode query param", () => {
        const uri = "postgresql://user:pass@localhost:5432/mydb?sslmode=require";
        const config = parseConnectionUri(uri);

        expect(config.sslMode).toBe(SslMode.Require);
      });

      it("should decode URL-encoded username and password", () => {
        const uri = "postgresql://my%40user:p%40ss%3Dword@localhost:5432/mydb";
        const config = parseConnectionUri(uri);

        expect(config.username).toBe("my@user");
        expect(config.password).toBe("p@ss=word");
      });
    });

    describe("MySQL URIs", () => {
      it("should parse basic MySQL URI", () => {
        const uri = "mysql://root:password@localhost:3306/mydb";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mysql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("3306");
        expect(config.username).toBe("root");
        expect(config.password).toBe("password");
        expect(config.database).toBe("mydb");
      });

      it("should handle mariadb:// protocol", () => {
        const uri = "mariadb://user:pass@localhost:3306/mydb";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mariadb");
      });
    });

    describe("SQL Server URIs", () => {
      it("should parse mssql:// URI", () => {
        const uri = "mssql://sa:Password123@localhost:1433/master";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mssql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("1433");
        expect(config.username).toBe("sa");
        expect(config.password).toBe("Password123");
        expect(config.database).toBe("master");
      });

      it("should handle sqlserver:// protocol", () => {
        const uri = "sqlserver://user:pass@localhost:1433/master";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mssql");
      });
    });

    describe("SQLite URIs", () => {
      it("should parse SQLite file URI with triple slash", () => {
        const uri = "sqlite:///path/to/database.db";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe("/path/to/database.db");
      });

      it("should parse SQLite file URI with double slash", () => {
        const uri = "sqlite://path/to/database.db";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe("path/to/database.db");
      });

      it("should parse SQLite relative path", () => {
        const uri = "sqlite://./local.db";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe("./local.db");
      });

      it("should parse SQLite memory database", () => {
        const uri = "sqlite::memory:";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe(":memory:");
      });

      it("should parse SQLite file path without scheme", () => {
        const uri = "./seeds/sqlite/query_pilot_test.db";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("sqlite");
        expect(config.database).toBe("./seeds/sqlite/query_pilot_test.db");
      });
    });

    describe("JDBC URIs", () => {
      it("should parse JDBC PostgreSQL URI", () => {
        const uri = "jdbc:postgresql://user:pass@localhost:5432/mydb";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("postgresql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("5432");
        expect(config.username).toBe("user");
        expect(config.password).toBe("pass");
        expect(config.database).toBe("mydb");
      });

      it("should parse JDBC MySQL URI", () => {
        const uri = "jdbc:mysql://user:pass@localhost:3306/mydb?charset=utf8mb4";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mysql");
        expect(config.options).toEqual({ charset: "utf8mb4" });
      });

      it("should parse JDBC SQL Server URI with params", () => {
        const uri =
          "jdbc:sqlserver://localhost:1433;databaseName=todoapp;user=sa;password=DevPass123;trustServerCertificate=true";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mssql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("1433");
        expect(config.username).toBe("sa");
        expect(config.password).toBe("DevPass123");
        expect(config.database).toBe("todoapp");
        expect(config.options?.trustservercertificate).toBe("true");
      });
    });

    describe("SQL Server connection strings", () => {
      it("should parse ADO.NET style SQL Server connection string", () => {
        const uri =
          "Server=localhost,11435;Database=todoapp;User Id=sa;Password=DevPass123;TrustServerCertificate=true;";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mssql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("11435");
        expect(config.username).toBe("sa");
        expect(config.password).toBe("DevPass123");
        expect(config.database).toBe("todoapp");
        expect(config.options?.trustservercertificate).toBe("true");
      });

      it("should parse Data Source format with instance name", () => {
        const uri =
          "Data Source=localhost\\SQLEXPRESS,1433;Initial Catalog=master;User ID=sa;Password=Pass123;";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mssql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("1433");
        expect(config.database).toBe("master");
        expect(config.username).toBe("sa");
        expect(config.password).toBe("Pass123");
        expect(config.options?.instance_name).toBe("SQLEXPRESS");
      });
    });

    describe("MySQL DSN strings", () => {
      it("should parse MySQL DSN", () => {
        const uri = "mysql:host=localhost;port=3306;dbname=todoapp;charset=utf8mb4";
        const config = parseConnectionUri(uri);

        expect(config.dbType).toBe("mysql");
        expect(config.host).toBe("localhost");
        expect(config.port).toBe("3306");
        expect(config.database).toBe("todoapp");
        expect(config.options).toEqual({ charset: "utf8mb4" });
      });
    });

    describe("SSL modes", () => {
      it("should parse disable SSL mode", () => {
        const uriDisable = "postgresql://user:pass@localhost/db?sslmode=disable";
        expect(parseConnectionUri(uriDisable).sslMode).toBe(SslMode.Disable);

        const uriFalse = "postgresql://user:pass@localhost/db?ssl=false";
        expect(parseConnectionUri(uriFalse).sslMode).toBe(SslMode.Disable);
      });

      it("should parse allow and prefer SSL modes", () => {
        const uriAllow = "postgresql://user:pass@localhost/db?sslmode=allow";
        expect(parseConnectionUri(uriAllow).sslMode).toBe(SslMode.Allow);

        const uriPrefer = "postgresql://user:pass@localhost/db?sslmode=prefer";
        expect(parseConnectionUri(uriPrefer).sslMode).toBe(SslMode.Prefer);
      });

      it("should parse require SSL mode", () => {
        const uriRequire = "postgresql://user:pass@localhost/db?sslmode=require";
        expect(parseConnectionUri(uriRequire).sslMode).toBe(SslMode.Require);

        const uriTrue = "postgresql://user:pass@localhost/db?ssl=true";
        expect(parseConnectionUri(uriTrue).sslMode).toBe(SslMode.Require);
      });

      it("should parse verify-ca SSL mode", () => {
        const uri = "postgresql://user:pass@localhost/db?sslmode=verify-ca";
        expect(parseConnectionUri(uri).sslMode).toBe(SslMode.VerifyCa);
      });

      it("should parse verify-full SSL mode", () => {
        const uri = "postgresql://user:pass@localhost/db?sslmode=verify-full";
        expect(parseConnectionUri(uri).sslMode).toBe(SslMode.VerifyFull);
      });

      it("should parse verify identity aliases for MySQL", () => {
        const uri = "mysql://user:pass@localhost/db?sslmode=verify_identity";
        expect(parseConnectionUri(uri).sslMode).toBe(SslMode.VerifyFull);
      });
    });

    describe("error handling", () => {
      it("should throw error for unsupported protocol", () => {
        const uri = "ftp://localhost:21/mydb";
        expect(() => parseConnectionUri(uri)).toThrow("Unsupported protocol: ftp");
      });

      it("should throw error for invalid URI", () => {
        const uri = "not a valid uri";
        expect(() => parseConnectionUri(uri)).toThrow();
      });
    });

    describe("special characters", () => {
      it("should handle special characters in password", () => {
        const uri = "postgresql://user:p%40ss%21w%23rd@localhost:5432/mydb";
        const config = parseConnectionUri(uri);

        expect(config.password).toBe("p@ss!w#rd");
      });

      it("should handle special characters in database name", () => {
        const uri = "postgresql://user:pass@localhost:5432/my-db.test";
        const config = parseConnectionUri(uri);

        expect(config.database).toBe("my-db.test");
      });
    });
  });

  describe("MongoDB URIs", () => {
    it("should parse basic mongodb URI", () => {
      const uri = "mongodb://localhost:27017/test";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("mongodb");
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("27017");
      expect(config.database).toBe("test");
    });

    it("should parse mongodb URI with auth", () => {
      const uri = "mongodb://user:password@localhost:27017/mydb?authSource=admin";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("mongodb");
      expect(config.username).toBe("user");
      expect(config.password).toBe("password");
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("27017");
      expect(config.database).toBe("mydb");
      expect(config.options?.authSource).toBe("admin");
    });

    it("should parse mongodb+srv URI (Atlas)", () => {
      const uri = "mongodb+srv://user:password@cluster0.abc123.mongodb.net/mydb?retryWrites=true&w=majority";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("mongodb");
      expect(config.username).toBe("user");
      expect(config.password).toBe("password");
      expect(config.host).toBe("cluster0.abc123.mongodb.net");
      expect(config.port).toBeUndefined();
      expect(config.database).toBe("mydb");
      expect(config.options?.srv).toBe("true");
      expect(config.options?.retryWrites).toBe("true");
      expect(config.options?.w).toBe("majority");
    });

    it("should parse mongodb replica set URI", () => {
      const uri = "mongodb://host1:27017,host2:27017,host3:27017/mydb?replicaSet=rs0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("mongodb");
      expect(config.host).toBe("host1");
      expect(config.port).toBe("27017");
      expect(config.database).toBe("mydb");
      expect(config.options?.replicaSet).toBe("rs0");
      expect(config.options?.hosts).toBe("host1:27017,host2:27017,host3:27017");
    });

    it("should parse mongodb URI with tls option", () => {
      const uri = "mongodb://localhost:27017/mydb?tls=true";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("mongodb");
      expect(config.sslMode).toBe(SslMode.Require);
    });

    it("should handle special characters in mongodb password", () => {
      const uri = "mongodb://user:p%40ss%21w%23rd@localhost:27017/mydb";
      const config = parseConnectionUri(uri);
      expect(config.password).toBe("p@ss!w#rd");
    });
  });

  describe("Redis URIs", () => {
    it("should parse basic redis URI", () => {
      const uri = "redis://localhost:6379/0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("redis");
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("6379");
      expect(config.database).toBe("0");
    });

    it("should parse redis URI with ACL auth", () => {
      const uri = "redis://username:password@localhost:6379/0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("redis");
      expect(config.username).toBe("username");
      expect(config.password).toBe("password");
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("6379");
      expect(config.database).toBe("0");
    });

    it("should parse redis URI with legacy password auth", () => {
      const uri = "redis://:password@localhost:6379/0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("redis");
      expect(config.username).toBeUndefined();
      expect(config.password).toBe("password");
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("6379");
    });

    it("should parse rediss (TLS) URI", () => {
      const uri = "rediss://localhost:6380/0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("redis");
      expect(config.sslMode).toBe(SslMode.Require);
      expect(config.host).toBe("localhost");
      expect(config.port).toBe("6380");
    });

    it("should parse redis URI without port", () => {
      const uri = "redis://localhost/0";
      const config = parseConnectionUri(uri);
      expect(config.dbType).toBe("redis");
      expect(config.host).toBe("localhost");
      expect(config.port).toBeUndefined();
      expect(config.database).toBe("0");
    });

    it("should handle special characters in redis password", () => {
      const uri = "redis://:p%40ss%21w%23rd@localhost:6379/0";
      const config = parseConnectionUri(uri);
      expect(config.password).toBe("p@ss!w#rd");
    });
  });
});
