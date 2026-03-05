import type { SqlDialect } from "@/components/CodeEditor/types";
import { detectSqlDialect } from "@/utils/dialectDetector";

export function resolveDialectFromDbType(dbType?: string): SqlDialect {
  return detectSqlDialect(dbType ?? "postgres");
}
