import { memo, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconDatabase,
  IconTable,
  IconLink,
  IconBinaryTree,
  IconFilter,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface OutlineNode {
  type: "cte" | "table" | "join" | "subquery" | "where";
  name: string;
  line?: number;
  children?: OutlineNode[];
}

interface QueryOutlineProps {
  sql: string;
  onNavigate?: (line: number) => void;
}

/**
 * Parse SQL to extract structural elements for outline view
 */
function parseSqlOutline(sql: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];

  // Extract CTEs (WITH clause)
  const ctePattern = /\bWITH\s+(\w+)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = ctePattern.exec(sql)) !== null) {
    const cteName = match[1];
    const lineNumber = sql.substring(0, match.index).split("\n").length;

    if (cteName) {
      nodes.push({
        type: "cte",
        name: cteName,
        line: lineNumber,
      });
    }
  }

  // Extract table references (FROM/JOIN clauses)
  const tablePattern =
    /\b(?:FROM|JOIN)\s+(?:(\w+)\.)?(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;

  while ((match = tablePattern.exec(sql)) !== null) {
    const schema = match[1];
    const tableName = match[2];
    const alias = match[3];
    const lineNumber = sql.substring(0, match.index).split("\n").length;

    if (tableName) {
      const isJoin = sql.substring(match.index, match.index + 4).toUpperCase() === "JOIN";
      const fullName = schema ? `${schema}.${tableName}` : tableName;
      const displayName = alias ? `${fullName} (${alias})` : fullName;

      nodes.push({
        type: isJoin ? "join" : "table",
        name: displayName,
        line: lineNumber,
      });
    }
  }

  // Extract subqueries - look for SELECT within parentheses
  const subqueryPattern = /\(\s*SELECT\s+/gi;
  let subqueryCount = 0;

  while ((match = subqueryPattern.exec(sql)) !== null) {
    subqueryCount++;
    const lineNumber = sql.substring(0, match.index).split("\n").length;

    nodes.push({
      type: "subquery",
      name: `Subquery ${subqueryCount}`,
      line: lineNumber,
    });
  }

  // Extract WHERE clauses
  const wherePattern = /\bWHERE\s+/gi;

  while ((match = wherePattern.exec(sql)) !== null) {
    const lineNumber = sql.substring(0, match.index).split("\n").length;

    nodes.push({
      type: "where",
      name: "WHERE clause",
      line: lineNumber,
    });
  }

  // Sort by line number
  return nodes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Get icon for node type
 */
function getNodeIcon(type: OutlineNode["type"]) {
  switch (type) {
    case "cte":
      return IconDatabase;
    case "table":
      return IconTable;
    case "join":
      return IconLink;
    case "subquery":
      return IconBinaryTree;
    case "where":
      return IconFilter;
    default:
      return IconTable;
  }
}

/**
 * Get label color for node type
 */
function getNodeColor(type: OutlineNode["type"]) {
  switch (type) {
    case "cte":
      return "text-blue-600 dark:text-blue-400";
    case "table":
      return "text-emerald-600 dark:text-emerald-400";
    case "join":
      return "text-purple-600 dark:text-purple-400";
    case "subquery":
      return "text-orange-600 dark:text-orange-400";
    case "where":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

export const QueryOutline = memo(function QueryOutline({
  sql,
  onNavigate,
}: QueryOutlineProps) {
  const outline = useMemo(() => parseSqlOutline(sql), [sql]);

  if (outline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <IconBinaryTree className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-sm">
          No structure detected
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Write a query with CTEs, JOINs, or subqueries
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {outline.map((node, index) => {
          const Icon = getNodeIcon(node.type);
          const colorClass = getNodeColor(node.type);

          return (
            <div
              key={`${node.type}-${node.name}-${index}`}
              className={cn(
                "group rounded-md p-2 cursor-pointer hover:bg-muted/50 transition-colors border border-transparent hover:border-border",
              )}
              onClick={() => {
                if (node.line && onNavigate) {
                  onNavigate(node.line);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4 flex-shrink-0", colorClass)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">
                      {node.name}
                    </span>
                    {node.line && (
                      <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        L{node.line}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {node.type}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
});
