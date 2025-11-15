import { DbType } from "@/types/connection";

const DB_LOGO_MAP: Record<DbType, string> = {
  [DbType.PostgreSQL]: "/logos/postgresql-icon.svg",
  [DbType.MySQL]: "/logos/mysql-icon.svg",
  [DbType.SQLite]: "/logos/sqlite-icon.svg",
  [DbType.SQLServer]: "/logos/mssql-server-logo.svg",
};

// Additional database logos for future support
export const ADDITIONAL_DB_LOGOS = {
  mariadb: "/logos/mariadb-icon.svg",
  mongodb: "/logos/mongodb-icon.svg",
  oracle: "/logos/oracle-icon.svg",
  redis: "/logos/redis-icon.svg",
  duckdb: "/logos/duckdb-logo.svg",
  cloudflare: "/logos/cloudflared1-icon.svg",
} as const;

export function getDatabaseLogo(dbType: DbType): string {
  return DB_LOGO_MAP[dbType];
}

export function getDatabaseLogoByName(name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return ADDITIONAL_DB_LOGOS[lowerName as keyof typeof ADDITIONAL_DB_LOGOS];
}
