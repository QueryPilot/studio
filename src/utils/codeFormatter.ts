import { format as sqlFormat } from "sql-formatter";
import type { SqlDialect } from "@/components/CodeEditor/types";

/**
 * Format SQL code using sql-formatter
 */
export function formatSql(
  code: string,
  dialect: SqlDialect = "postgresql",
): string {
  if (!code.trim()) {
    return code;
  }

  try {
    // Map our dialect types to sql-formatter's language names
    const languageMap: Record<SqlDialect, string> = {
      postgresql: "postgresql",
      mysql: "mysql",
      sqlite: "sqlite",
      plsql: "plsql",
      mssql: "tsql",
    };

    const formatted = sqlFormat(code, {
      language: (languageMap[dialect] || "postgresql") as any,
      tabWidth: 2,
      keywordCase: "upper",
      indentStyle: "standard",
      linesBetweenQueries: 2,
      denseOperators: false,
      newlineBeforeSemicolon: false,
    });

    return formatted;
  } catch (error) {
    console.error("SQL formatting error:", error);
    // Return original code if formatting fails
    return code;
  }
}

/**
 * Format JSON code
 */
export function formatJson(code: string): string {
  if (!code.trim()) {
    return code;
  }

  try {
    const parsed = JSON.parse(code);
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    console.error("JSON formatting error:", error);
    return code;
  }
}

/**
 * Format code based on language type
 */
export function formatCode(
  code: string,
  language: "sql" | "json" | "text" = "sql",
  dialect?: SqlDialect,
): string {
  switch (language) {
    case "sql":
      return formatSql(code, dialect);
    case "json":
      return formatJson(code);
    case "text":
    default:
      return code;
  }
}
