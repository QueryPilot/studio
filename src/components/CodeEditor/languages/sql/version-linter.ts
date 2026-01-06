/**
 * Version-Aware SQL Linter
 *
 * Detects SQL syntax that may not be supported by the connected database version.
 * Provides warnings when using features that require newer database versions.
 */

import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, EditorState } from "@codemirror/state";
import type { SqlDialect } from "@/components/CodeEditor/types";
import {
  getPostgreSQLFeaturesForConnection,
  getMySQLFeaturesForConnection,
  getSQLiteFeaturesForConnection,
} from "@/stores/versionStore";

interface VersionRule {
  /** Pattern to detect the syntax (case-insensitive) */
  pattern: RegExp;
  /** Feature flag to check */
  feature: string;
  /** Warning message */
  message: string;
  /** Minimum version required */
  minVersion: string;
}

// ─────────────────────────────────────────────────────────────────
// PostgreSQL Version Rules
// ─────────────────────────────────────────────────────────────────

const POSTGRESQL_RULES: VersionRule[] = [
  {
    pattern: /\bMERGE\s+INTO\b/gi,
    feature: "supportsMerge",
    message: "MERGE statement requires PostgreSQL 15+",
    minVersion: "15.0",
  },
  {
    pattern: /\bJSON_TABLE\s*\(/gi,
    feature: "supportsJsonTable",
    message: "JSON_TABLE requires PostgreSQL 17+",
    minVersion: "17.0",
  },
  {
    pattern: /\bGENERATED\s+ALWAYS\s+AS\s+\(/gi,
    feature: "supportsGeneratedColumns",
    message: "Generated columns require PostgreSQL 12+",
    minVersion: "12.0",
  },
  {
    pattern: /\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/gi,
    feature: "supportsIdentityColumns",
    message: "IDENTITY columns require PostgreSQL 10+",
    minVersion: "10.0",
  },
  {
    pattern: /\bINCLUDE\s*\([^)]+\)\s*$/gim,
    feature: "supportsIndexInclude",
    message: "INCLUDE clause in indexes requires PostgreSQL 11+",
    minVersion: "11.0",
  },
  {
    pattern: /\bCREATE\s+INDEX\s+(CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\b/gi,
    feature: "supportsCreateIndexConcurrentlyIfNotExists",
    message: "CREATE INDEX IF NOT EXISTS requires PostgreSQL 9.5+",
    minVersion: "9.5",
  },
  {
    pattern: /\bCALL\s+\w+\s*\(/gi,
    feature: "supportsStoredProcedures",
    message: "CALL statement for procedures requires PostgreSQL 11+",
    minVersion: "11.0",
  },
  {
    pattern: /\bPARTITION\s+BY\s+HASH\b/gi,
    feature: "supportsHashPartitioning",
    message: "Hash partitioning requires PostgreSQL 11+",
    minVersion: "11.0",
  },
  {
    pattern: /\bPARTITION\s+BY\s+(RANGE|LIST)\b/gi,
    feature: "supportsPartitioning",
    message: "Table partitioning requires PostgreSQL 10+",
    minVersion: "10.0",
  },
  {
    pattern: /\s@\?\s|\s@@\s/g,
    feature: "supportsJsonPath",
    message: "JSON path operators (@? and @@) require PostgreSQL 12+",
    minVersion: "12.0",
  },
];

// ─────────────────────────────────────────────────────────────────
// MySQL/MariaDB Version Rules
// ─────────────────────────────────────────────────────────────────

const MYSQL_RULES: VersionRule[] = [
  {
    pattern: /\bWITH\s+\w+\s+AS\s*\(/gi,
    feature: "supportsCTEs",
    message: "CTEs (WITH clause) require MySQL 8.0+ or MariaDB 10.2.1+",
    minVersion: "8.0",
  },
  {
    pattern: /\b(ROW_NUMBER|RANK|DENSE_RANK|LEAD|LAG|FIRST_VALUE|LAST_VALUE|NTH_VALUE)\s*\(\s*\)\s*OVER\s*\(/gi,
    feature: "supportsWindowFunctions",
    message: "Window functions require MySQL 8.0+ or MariaDB 10.2+",
    minVersion: "8.0",
  },
  {
    pattern: /\bJSON_TABLE\s*\(/gi,
    feature: "supportsJsonTable",
    message: "JSON_TABLE requires MySQL 8.0+ or MariaDB 10.6+",
    minVersion: "8.0",
  },
  {
    pattern: /\bCHECK\s*\([^)]+\)/gi,
    feature: "supportsCheckConstraints",
    message: "CHECK constraints require MySQL 8.0.16+ or MariaDB 10.2.1+",
    minVersion: "8.0.16",
  },
  {
    pattern: /\bRENAME\s+COLUMN\s+\w+\s+TO\b/gi,
    feature: "supportsRenameColumn",
    message: "RENAME COLUMN requires MySQL 8.0+ or MariaDB 10.5.2+",
    minVersion: "8.0",
  },
  {
    pattern: /\bDROP\s+INDEX\s+IF\s+EXISTS\b/gi,
    feature: "supportsDropIndexIfExists",
    message: "DROP INDEX IF EXISTS requires MySQL 8.0.29+ or MariaDB 10.1.4+",
    minVersion: "8.0.29",
  },
  {
    pattern: /\bINVISIBLE\b/gi,
    feature: "supportsInvisibleColumns",
    message: "INVISIBLE columns require MySQL 8.0.23+ or MariaDB 10.3.3+",
    minVersion: "8.0.23",
  },
];

// ─────────────────────────────────────────────────────────────────
// SQLite Version Rules
// ─────────────────────────────────────────────────────────────────

const SQLITE_RULES: VersionRule[] = [
  {
    pattern: /\bRETURNING\b/gi,
    feature: "supportsReturning",
    message: "RETURNING clause requires SQLite 3.35.0+",
    minVersion: "3.35.0",
  },
  {
    pattern: /\bDROP\s+COLUMN\b/gi,
    feature: "supportsDropColumn",
    message: "DROP COLUMN requires SQLite 3.35.0+",
    minVersion: "3.35.0",
  },
  {
    pattern: /\bRENAME\s+COLUMN\s+\w+\s+TO\b/gi,
    feature: "supportsRenameColumn",
    message: "RENAME COLUMN requires SQLite 3.25.0+",
    minVersion: "3.25.0",
  },
  {
    pattern: /\b(ROW_NUMBER|RANK|DENSE_RANK|LEAD|LAG|FIRST_VALUE|LAST_VALUE|NTH_VALUE)\s*\(\s*\)\s*OVER\s*\(/gi,
    feature: "supportsWindowFunctions",
    message: "Window functions require SQLite 3.25.0+",
    minVersion: "3.25.0",
  },
  {
    pattern: /\bON\s+CONFLICT\s*\([^)]+\)\s+DO\s+(UPDATE|NOTHING)\b/gi,
    feature: "supportsUpsert",
    message: "UPSERT (ON CONFLICT) requires SQLite 3.24.0+",
    minVersion: "3.24.0",
  },
  {
    pattern: /\bSTRICT\s*$/gim,
    feature: "supportsStrictTables",
    message: "STRICT tables require SQLite 3.37.0+",
    minVersion: "3.37.0",
  },
  {
    pattern: /\bjson\s*\(|->>\s*|->>\s*'/gi,
    feature: "supportsNativeJson",
    message: "Native JSON functions require SQLite 3.38.0+",
    minVersion: "3.38.0",
  },
];

// Shared no-op action to avoid object allocation per diagnostic
const NO_OP_ACTION = { name: "", apply: () => {} };

/**
 * Find all matches of a pattern in text (optimized)
 * Pre-resets lastIndex to avoid regex state issues
 */
function findPatternMatches(
  text: string,
  pattern: RegExp
): Array<{ from: number; to: number }> {
  // Reset lastIndex for global regex reuse
  pattern.lastIndex = 0;

  const matches: Array<{ from: number; to: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
    });
    // Prevent infinite loop for zero-width matches
    if (match[0].length === 0) pattern.lastIndex++;
  }

  return matches;
}

/**
 * Generic rule checker - reduces code duplication and ensures single doc.toString()
 */
function checkRules(
  text: string,
  rules: VersionRule[],
  features: Record<string, unknown>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    // Skip if feature is supported - early exit per rule
    if (features[rule.feature]) {
      continue;
    }

    const matches = findPatternMatches(text, rule.pattern);
    for (const match of matches) {
      diagnostics.push({
        from: match.from,
        to: match.to,
        severity: "warning",
        message: rule.message,
        // Reuse action object pattern - include version in message instead
        actions: [{ ...NO_OP_ACTION, name: `Requires ${rule.minVersion}` }],
      });
    }
  }

  return diagnostics;
}

/**
 * Check PostgreSQL version rules
 */
function checkPostgreSQLRules(text: string, connectionId: string): Diagnostic[] {
  const features = getPostgreSQLFeaturesForConnection(connectionId);
  return checkRules(text, POSTGRESQL_RULES, features as unknown as Record<string, unknown>);
}

/**
 * Check MySQL/MariaDB version rules
 */
function checkMySQLRules(text: string, connectionId: string): Diagnostic[] {
  const features = getMySQLFeaturesForConnection(connectionId);
  return checkRules(text, MYSQL_RULES, features as unknown as Record<string, unknown>);
}

/**
 * Check SQLite version rules
 */
function checkSQLiteRules(text: string, connectionId: string): Diagnostic[] {
  const features = getSQLiteFeaturesForConnection(connectionId);
  return checkRules(text, SQLITE_RULES, features as unknown as Record<string, unknown>);
}

/**
 * Collect version-aware diagnostics based on dialect
 * Optimized: single doc.toString() call, early exit for unsupported dialects
 */
function collectVersionDiagnostics(
  state: EditorState,
  dialect: SqlDialect,
  connectionId: string
): Diagnostic[] {
  // Skip if no connection (can't check version) or unsupported dialect
  if (!connectionId) return [];
  if (dialect !== "postgresql" && dialect !== "mysql" && dialect !== "sqlite") {
    return [];
  }

  // Single doc.toString() call - pass text to all checkers
  const text = state.doc.toString();

  switch (dialect) {
    case "postgresql":
      return checkPostgreSQLRules(text, connectionId);
    case "mysql":
      return checkMySQLRules(text, connectionId);
    case "sqlite":
      return checkSQLiteRules(text, connectionId);
    default:
      return [];
  }
}

/**
 * Create a version-aware SQL linter extension
 *
 * @param dialect - The SQL dialect (postgresql, mysql, sqlite)
 * @param connectionId - Connection ID for version lookup
 * @returns CodeMirror linter extension
 */
export function createVersionLinter(
  dialect: SqlDialect,
  connectionId: string
): Extension {
  return linter(
    (view) => {
      // Skip for short content
      if (view.state.doc.length < 10) return [];
      return collectVersionDiagnostics(view.state, dialect, connectionId);
    },
    {
      delay: 1000,
      needsRefresh: (update) => update.docChanged,
    }
  );
}

/**
 * Get human-readable version info for tooltip
 */
export function getVersionRequirementMessage(
  dialect: SqlDialect,
  feature: string
): string | null {
  let rules: VersionRule[];

  switch (dialect) {
    case "postgresql":
      rules = POSTGRESQL_RULES;
      break;
    case "mysql":
      rules = MYSQL_RULES;
      break;
    case "sqlite":
      rules = SQLITE_RULES;
      break;
    default:
      return null;
  }

  const rule = rules.find((r) => r.feature === feature);
  return rule?.message ?? null;
}
