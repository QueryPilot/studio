import { memo, useState, useEffect, useCallback, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconDatabase,
  IconTable,
  IconLink,
  IconBinaryTree,
  IconCode,
  IconChevronDown,
  IconChevronRight,
  IconAlertTriangle,
  IconAlertCircle,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  getOutline,
  type OutlineTree,
  type StatementOutline,
  type CteOutline,
  type TableOutline,
  type ParseStatus,
} from "@/components/CodeEditor/languages/sql/refactor-service";

interface QueryOutlineProps {
  sql: string;
  dialect: string;
  onNavigate?: (position: number) => void;
}

interface TreeNodeProps {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  position?: number;
  suffix?: string;
  onNavigate?: (position: number) => void;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}

/**
 * Collapsible tree node component
 */
function TreeNode({
  label,
  icon: Icon,
  iconColor,
  position,
  suffix,
  onNavigate,
  children,
  defaultExpanded = true,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = Boolean(children);

  return (
    <div className="select-none">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
          position !== undefined
            ? "cursor-pointer hover:bg-muted/50"
            : hasChildren
              ? "cursor-pointer"
              : "",
        )}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          if (position !== undefined && onNavigate) {
            onNavigate(position);
          }
        }}
      >
        {hasChildren ? (
          expanded ? (
            <IconChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <IconChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className={cn("h-4 w-4 shrink-0", iconColor)} />
        <span className="text-xs font-medium truncate">{label}</span>
        {suffix && (
          <span className="text-xs text-muted-foreground ml-1">{suffix}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="ml-4 border-l border-border/50 pl-2">{children}</div>
      )}
    </div>
  );
}

/**
 * Render a CTE outline node
 */
function CteNode({
  cte,
  onNavigate,
}: {
  cte: CteOutline;
  onNavigate?: (position: number) => void;
}) {
  return (
    <TreeNode
      label={cte.name}
      icon={IconDatabase}
      iconColor="text-blue-600 dark:text-blue-400"
      position={cte.span.start}
      onNavigate={onNavigate}
    />
  );
}

/**
 * Render a table outline node
 */
function TableNode({
  table,
  onNavigate,
}: {
  table: TableOutline;
  onNavigate?: (position: number) => void;
}) {
  const displayName = table.alias
    ? `${table.name} AS ${table.alias}`
    : table.name;
  const suffix = table.join_type ? `(${table.join_type} JOIN)` : undefined;

  return (
    <TreeNode
      label={displayName}
      icon={table.join_type ? IconLink : IconTable}
      iconColor={
        table.join_type
          ? "text-purple-600 dark:text-purple-400"
          : "text-emerald-600 dark:text-emerald-400"
      }
      position={table.span.start}
      suffix={suffix}
      onNavigate={onNavigate}
    />
  );
}

/**
 * Render a statement outline recursively (handles subqueries)
 */
function StatementNode({
  statement,
  onNavigate,
  isSubquery = false,
  subqueryIndex,
}: {
  statement: StatementOutline;
  onNavigate?: (position: number) => void;
  isSubquery?: boolean;
  subqueryIndex?: number;
}) {
  const hasCtes = statement.ctes.length > 0;
  const hasTables = statement.tables.length > 0;
  const hasSubqueries = statement.subqueries.length > 0;
  const hasContent = hasCtes || hasTables || hasSubqueries;

  const label = isSubquery
    ? `Subquery ${subqueryIndex !== undefined ? subqueryIndex + 1 : ""}`
    : statement.kind;

  return (
    <TreeNode
      label={label}
      icon={isSubquery ? IconBinaryTree : IconCode}
      iconColor={
        isSubquery ? "text-orange-600 dark:text-orange-400" : "text-foreground"
      }
      position={statement.span.start}
      onNavigate={onNavigate}
      defaultExpanded={!isSubquery}
    >
      {hasContent && (
        <>
          {hasCtes && (
            <TreeNode
              label="CTEs"
              icon={IconDatabase}
              iconColor="text-blue-600 dark:text-blue-400"
              defaultExpanded={true}
            >
              {statement.ctes.map((cte, idx) => (
                <CteNode key={`cte-${idx}`} cte={cte} onNavigate={onNavigate} />
              ))}
            </TreeNode>
          )}
          {hasTables && (
            <TreeNode
              label="Tables"
              icon={IconTable}
              iconColor="text-emerald-600 dark:text-emerald-400"
              defaultExpanded={true}
            >
              {statement.tables.map((table, idx) => (
                <TableNode
                  key={`table-${idx}`}
                  table={table}
                  onNavigate={onNavigate}
                />
              ))}
            </TreeNode>
          )}
          {hasSubqueries && (
            <TreeNode
              label="Subqueries"
              icon={IconBinaryTree}
              iconColor="text-orange-600 dark:text-orange-400"
              defaultExpanded={true}
            >
              {statement.subqueries.map((subquery, idx) => (
                <StatementNode
                  key={`subquery-${idx}`}
                  statement={subquery}
                  onNavigate={onNavigate}
                  isSubquery={true}
                  subqueryIndex={idx}
                />
              ))}
            </TreeNode>
          )}
        </>
      )}
    </TreeNode>
  );
}

/**
 * Parse status warning/error banner
 */
function ParseStatusBanner({ status }: { status: ParseStatus }) {
  if (status === "Full") return null;

  const isPartial = status === "Partial";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs border-b",
        isPartial
          ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
          : "bg-destructive/10 text-destructive border-destructive/20",
      )}
    >
      {isPartial ? (
        <>
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          <span>Partial parse - some elements may be missing</span>
        </>
      ) : (
        <>
          <IconAlertCircle className="h-4 w-4 shrink-0" />
          <span>Parse failed - outline unavailable</span>
        </>
      )}
    </div>
  );
}

/**
 * Debounce hook
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export const QueryOutline = memo(function QueryOutline({
  sql,
  dialect,
  onNavigate,
}: QueryOutlineProps) {
  const [outline, setOutline] = useState<OutlineTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce SQL changes to avoid excessive parsing
  const debouncedSql = useDebouncedValue(sql, 300);

  // Track current request to handle race conditions
  const requestIdRef = useRef(0);

  // Fetch outline when debounced SQL or dialect changes
  useEffect(() => {
    if (!debouncedSql.trim()) {
      setOutline(null);
      setError(null);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    getOutline(debouncedSql, dialect)
      .then((result) => {
        // Ignore stale responses
        if (currentRequestId !== requestIdRef.current) return;

        setOutline(result);
        setLoading(false);
      })
      .catch((err) => {
        // Ignore stale responses
        if (currentRequestId !== requestIdRef.current) return;

        console.error("[QueryOutline] Error fetching outline:", err);
        setError("Failed to parse query");
        setOutline(null);
        setLoading(false);
      });
  }, [debouncedSql, dialect]);

  // Handle navigation callback - convert position to the expected format
  const handleNavigate = useCallback(
    (position: number) => {
      if (onNavigate) {
        onNavigate(position);
      }
    },
    [onNavigate],
  );

  // Loading state
  if (loading && !outline) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">Parsing...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <IconAlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <p className="text-muted-foreground text-sm">{error}</p>
      </div>
    );
  }

  // Empty state or failed parse with no statements
  if (
    !outline ||
    outline.statements.length === 0 ||
    outline.parse_status === "Failed"
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <IconBinaryTree className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-sm">No structure detected</p>
        <p className="text-xs text-muted-foreground mt-1">
          Write a query with CTEs, JOINs, or subqueries
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ParseStatusBanner status={outline.parse_status} />
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {outline.statements.map((statement, idx) => (
            <StatementNode
              key={`statement-${idx}`}
              statement={statement}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});
