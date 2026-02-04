/**
 * Query Block Component
 *
 * Renders inline SQL/MongoDB/Redis queries with a Run button in the AI panel.
 * Displays syntax-highlighted code with connection badge and execution capability.
 */

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconPlayerPlay,
  IconCopy,
  IconCheck,
  IconDatabase,
  IconChevronDown,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useConnectionStore } from "@/stores/connectionStoreNew";

// ============================================================================
// Types
// ============================================================================

export interface QueryBlockProps {
  /** The SQL/MongoDB/Redis query */
  query: string;
  /** Language for syntax highlighting (sql, mongodb, redis) */
  language?: string;
  /** Connection ID to run against (from context) */
  connectionId?: string;
  /** Display name for connection badge */
  connectionName?: string;
  /** Callback when Run is clicked */
  onRun: (query: string, connectionId: string) => void;
}

// ============================================================================
// SQL Syntax Highlighting (simple tokenizer)
// ============================================================================

type SqlTokenType = "keyword" | "string" | "number" | "comment" | "operator" | "identifier" | "punctuation";

interface SqlToken {
  type: SqlTokenType;
  value: string;
}

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL", "AS",
  "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "ON",
  "GROUP", "BY", "ORDER", "ASC", "DESC", "HAVING", "LIMIT", "OFFSET",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE",
  "DROP", "ALTER", "INDEX", "VIEW", "TRIGGER", "FUNCTION", "PROCEDURE",
  "BEGIN", "END", "IF", "ELSE", "THEN", "CASE", "WHEN", "UNION", "ALL",
  "DISTINCT", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "WITH", "RECURSIVE",
  "TRUE", "FALSE", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE",
  "CAST", "NULLIF", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT",
  "DEFAULT", "CHECK", "UNIQUE", "CASCADE", "RESTRICT", "RETURNING",
]);

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let remaining = sql;

  while (remaining.length > 0) {
    // Single-line comment
    const singleCommentMatch = remaining.match(/^(--[^\n]*)/);
    if (singleCommentMatch?.[1]) {
      tokens.push({ type: "comment", value: singleCommentMatch[1] });
      remaining = remaining.slice(singleCommentMatch[0].length);
      continue;
    }

    // Multi-line comment
    const multiCommentMatch = remaining.match(/^(\/\*[\s\S]*?\*\/)/);
    if (multiCommentMatch?.[1]) {
      tokens.push({ type: "comment", value: multiCommentMatch[1] });
      remaining = remaining.slice(multiCommentMatch[0].length);
      continue;
    }

    // String (single quotes)
    const stringMatch = remaining.match(/^('(?:[^'\\]|\\.)*')/);
    if (stringMatch?.[1]) {
      tokens.push({ type: "string", value: stringMatch[1] });
      remaining = remaining.slice(stringMatch[0].length);
      continue;
    }

    // String (double quotes - identifiers in some DBs)
    const doubleStringMatch = remaining.match(/^("(?:[^"\\]|\\.)*")/);
    if (doubleStringMatch?.[1]) {
      tokens.push({ type: "identifier", value: doubleStringMatch[1] });
      remaining = remaining.slice(doubleStringMatch[0].length);
      continue;
    }

    // Number
    const numberMatch = remaining.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/);
    if (numberMatch?.[1]) {
      tokens.push({ type: "number", value: numberMatch[1] });
      remaining = remaining.slice(numberMatch[0].length);
      continue;
    }

    // Identifier or keyword
    const wordMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (wordMatch?.[1]) {
      const word = wordMatch[1];
      const isKeyword = SQL_KEYWORDS.has(word.toUpperCase());
      tokens.push({ type: isKeyword ? "keyword" : "identifier", value: word });
      remaining = remaining.slice(wordMatch[0].length);
      continue;
    }

    // Operators
    const operatorMatch = remaining.match(/^(>=|<=|<>|!=|::|\|\||->|->>|[+\-*/%<>=!&|^~])/);
    if (operatorMatch?.[1]) {
      tokens.push({ type: "operator", value: operatorMatch[1] });
      remaining = remaining.slice(operatorMatch[0].length);
      continue;
    }

    // Punctuation and whitespace
    const punctMatch = remaining.match(/^([\s\n()[\]{},;.:*]+)/);
    if (punctMatch?.[1]) {
      tokens.push({ type: "punctuation", value: punctMatch[1] });
      remaining = remaining.slice(punctMatch[0].length);
      continue;
    }

    // Fallback: consume one character
    tokens.push({ type: "punctuation", value: remaining[0] ?? "" });
    remaining = remaining.slice(1);
  }

  return tokens;
}

const TOKEN_COLORS: Record<SqlTokenType, string> = {
  keyword: "text-blue-600 dark:text-blue-400 font-medium",
  string: "text-emerald-700 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  comment: "text-muted-foreground/60 italic",
  operator: "text-purple-600 dark:text-purple-400",
  identifier: "text-foreground",
  punctuation: "text-muted-foreground",
};

function HighlightedSql({ code }: { code: string }) {
  const tokens = useMemo(() => tokenizeSql(code), [code]);

  return (
    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
      {tokens.map((token, i) => (
        <span key={i} className={TOKEN_COLORS[token.type]}>
          {token.value}
        </span>
      ))}
    </pre>
  );
}

// ============================================================================
// Connection Picker Dropdown
// ============================================================================

interface ConnectionPickerProps {
  onSelect: (connectionId: string, connectionName: string) => void;
  children: React.ReactNode;
}

function ConnectionPicker({ onSelect, children }: ConnectionPickerProps) {
  const connections = useConnectionStore((s) => s.connections);
  const recentConnections = useConnectionStore((s) => s.getRecentConnections(5));

  // Group connections by database type
  const groupedConnections = useMemo(() => {
    const groups: Record<string, typeof connections> = {};
    for (const conn of connections) {
      const dbType = conn.profile.db_type;
      if (!groups[dbType]) {
        groups[dbType] = [];
      }
      groups[dbType].push(conn);
    }
    return groups;
  }, [connections]);

  const hasConnections = connections.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <span {...props}>{children}</span>
        )}
      />
      <DropdownMenuContent align="end" side="top" className="w-64">
        {!hasConnections ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No connections available
          </div>
        ) : (
          <>
            {/* Recent Connections */}
            {recentConnections.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[10px]">Recent</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {recentConnections.map((conn) => (
                    <DropdownMenuItem
                      key={conn.profile.id}
                      onClick={() => { onSelect(conn.profile.id, conn.profile.name); }}
                      className="gap-2"
                    >
                      <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[12px] truncate">{conn.profile.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {conn.profile.db_type}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}

            {/* All Connections by Type */}
            {Object.entries(groupedConnections).map(([dbType, conns]) => (
              <DropdownMenuGroup key={dbType}>
                <DropdownMenuLabel className="text-[10px]">{dbType}</DropdownMenuLabel>
                {conns.map((conn) => (
                  <DropdownMenuItem
                    key={conn.profile.id}
                    onClick={() => { onSelect(conn.profile.id, conn.profile.name); }}
                    className="gap-2"
                  >
                    <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[12px] truncate">{conn.profile.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// Query Block Component
// ============================================================================

export function QueryBlock({
  query,
  language = "sql",
  connectionId,
  connectionName,
  onRun,
}: QueryBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch (err) {
      console.error("Failed to copy query:", err);
    }
  }, [query]);

  // Handle run with known connection
  const handleRun = useCallback(() => {
    if (connectionId) {
      onRun(query, connectionId);
    }
  }, [query, connectionId, onRun]);

  // Handle run with selected connection (from picker)
  const handleRunWithConnection = useCallback(
    (selectedConnectionId: string) => {
      onRun(query, selectedConnectionId);
    },
    [query, onRun]
  );

  // Normalize language display
  const displayLanguage = language.toLowerCase();
  const isSQL = displayLanguage === "sql" || displayLanguage === "mysql" ||
                displayLanguage === "postgresql" || displayLanguage === "pgsql" ||
                displayLanguage === "sqlite" || displayLanguage === "mssql";

  return (
    <div
      data-slot="query-block"
      className={cn(
        "group relative rounded-lg border bg-muted/30 text-xs my-2 transition-all",
        isHovered && "border-primary/40 shadow-sm"
      )}
      onMouseEnter={() => { setIsHovered(true); }}
      onMouseLeave={() => { setIsHovered(false); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">
          {displayLanguage}
        </span>
        <div className="flex items-center gap-2">
          {/* Connection Badge */}
          {connectionName && (
            <Badge variant="outline" size="xs" className="gap-1">
              <IconPlugConnected className="h-2.5 w-2.5" />
              {connectionName}
            </Badge>
          )}
          {/* Copy Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {copied ? (
              <IconCheck className="h-3 w-3 text-green-500" />
            ) : (
              <IconCopy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Code Content */}
      <div className="relative overflow-x-auto px-3 py-2">
        {isSQL ? (
          <HighlightedSql code={query} />
        ) : (
          <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
            <code>{query}</code>
          </pre>
        )}
      </div>

      {/* Footer with Run Button */}
      <div className="flex items-center justify-end border-t border-border/50 px-2 py-1.5">
        {connectionId ? (
          // Direct run button when connection is known
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRun}
            className="h-6 px-2 text-xs gap-1 hover:bg-primary/10 hover:text-primary"
          >
            <IconPlayerPlay className="h-3 w-3" />
            Run
          </Button>
        ) : (
          // Connection picker dropdown when no connection specified
          <ConnectionPicker onSelect={handleRunWithConnection}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs gap-1 hover:bg-primary/10 hover:text-primary"
            >
              <IconPlayerPlay className="h-3 w-3" />
              Run
              <IconChevronDown className="h-2.5 w-2.5 ml-0.5" />
            </Button>
          </ConnectionPicker>
        )}
      </div>
    </div>
  );
}

export default QueryBlock;
