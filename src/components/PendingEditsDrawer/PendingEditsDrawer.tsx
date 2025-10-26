/**
 * Pending Edits Drawer
 *
 * Main preview interface for all pending changes with domain tabs.
 */

import { memo, useState, useCallback, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Database,
  Table2,
  Zap,
  Grid3x3,
  CheckCircle,
  AlertCircle,
  Copy,
  Download,
  Loader2,
} from "lucide-react";
import { useConnectionEditSummary } from "@/stores/tableEditStore.selectors";
import { useTableEditStore, parseScopeKey } from "@/stores/tableEditStore";
import type { DomainKind } from "@/stores/tableEditStore.types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Types
// ============================================================================

interface PendingEditsDrawerProps {
  connectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

export const PendingEditsDrawer = memo(function PendingEditsDrawer({
  connectionId,
  open,
  onOpenChange,
}: PendingEditsDrawerProps) {
  const summary = useConnectionEditSummary(connectionId);
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DomainKind>("data");
  const [isValidating, setIsValidating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Get domain counts
  const domainCounts = useMemo(() => {
    const totals = {
      data: 0,
      structure: 0,
      indexes: 0,
      triggers: 0,
    };

    for (const scopeSummary of summary.byScope.values()) {
      totals.data += scopeSummary.byDomain.data;
      totals.structure += scopeSummary.byDomain.structure;
      totals.indexes += scopeSummary.byDomain.indexes;
      totals.triggers += scopeSummary.byDomain.triggers;
    }

    return totals;
  }, [summary.byScope]);

  const handleValidate = useCallback(async () => {
    console.log("🔍 Validate button clicked");
    setIsValidating(true);
    // TODO: Implement validation with backend
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsValidating(false);
    toast({
      title: "Validation",
      description: "Validation not yet implemented",
    });
  }, [toast]);

  const handleApplyAll = useCallback(async () => {
    console.log("✅ Apply All button clicked");
    setIsApplying(true);
    // TODO: Implement apply all changes
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsApplying(false);
    toast({
      title: "Apply Changes",
      description: "Apply all not yet implemented",
    });
  }, [toast]);

  const handleCopySQL = useCallback(() => {
    console.log("📋 Copy SQL button clicked");
    // TODO: Generate and copy SQL for all changes
    toast({
      title: "Copy SQL",
      description: "SQL copy not yet implemented",
    });
  }, [toast]);

  const handleExport = useCallback(() => {
    console.log("💾 Export button clicked");
    // TODO: Export changes to file
    toast({
      title: "Export",
      description: "Export not yet implemented",
    });
  }, [toast]);

  const handleDiscardAll = useCallback(() => {
    console.log("🗑️ Discard All button clicked", {
      totalChanges: summary.totalChanges,
      scopeCount: summary.scopeCount,
    });

    if (summary.totalChanges === 0) return;

    // Show confirmation
    if (
      confirm(
        `Are you sure you want to discard all ${summary.totalChanges} pending change(s) across ${summary.scopeCount} table(s)? This action cannot be undone.`,
      )
    ) {
      // Discard all scopes for this connection
      const store = useTableEditStore.getState();
      const scopesToDiscard: string[] = [];

      for (const [scopeKey, scopeState] of store.scopes.entries()) {
        if (scopeState.meta.connectionId === connectionId) {
          scopesToDiscard.push(scopeKey);
        }
      }

      scopesToDiscard.forEach((scopeKey) => {
        const parsed = parseScopeKey(scopeKey);
        if (parsed) {
          store.discardScope(parsed);
        }
      });

      toast({
        description: `Discarded all changes for ${summary.scopeCount} table(s)`,
      });

      onOpenChange(false);
    }
  }, [summary, connectionId, toast, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Pending Changes</SheetTitle>
              <SheetDescription>
                {summary.totalChanges} change
                {summary.totalChanges !== 1 ? "s" : ""} across{" "}
                {summary.scopeCount} table{summary.scopeCount !== 1 ? "s" : ""}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v as DomainKind);
            }}
            className="h-full flex flex-col"
          >
            {/* Tab List */}
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-6 h-auto">
              <TabsTrigger
                value="data"
                className="relative"
                disabled={domainCounts.data === 0}
              >
                <Database className="h-4 w-4 mr-2" />
                Data
                {domainCounts.data > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {domainCounts.data}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="structure"
                className="relative"
                disabled={domainCounts.structure === 0}
              >
                <Table2 className="h-4 w-4 mr-2" />
                Structure
                {domainCounts.structure > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {domainCounts.structure}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="indexes"
                className="relative"
                disabled={domainCounts.indexes === 0}
              >
                <Grid3x3 className="h-4 w-4 mr-2" />
                Indexes
                {domainCounts.indexes > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {domainCounts.indexes}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="triggers"
                className="relative"
                disabled={domainCounts.triggers === 0}
              >
                <Zap className="h-4 w-4 mr-2" />
                Triggers
                {domainCounts.triggers > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {domainCounts.triggers}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Tab Content */}
            <div className="flex-1 overflow-auto px-6 py-4">
              <TabsContent value="data" className="mt-0 h-full">
                <DataChangesTab connectionId={connectionId} />
              </TabsContent>
              <TabsContent value="structure" className="mt-0 h-full">
                <StructureChangesTab connectionId={connectionId} />
              </TabsContent>
              <TabsContent value="indexes" className="mt-0 h-full">
                <IndexesChangesTab connectionId={connectionId} />
              </TabsContent>
              <TabsContent value="triggers" className="mt-0 h-full">
                <TriggersChangesTab connectionId={connectionId} />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Footer Actions */}
        <div className="border-t px-6 py-4 flex items-center justify-between gap-4 bg-muted/30">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopySQL}
              disabled={summary.totalChanges === 0}
            >
              <Copy className="h-3 w-3 mr-2" />
              Copy SQL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={summary.totalChanges === 0}
            >
              <Download className="h-3 w-3 mr-2" />
              Export
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscardAll}
              disabled={summary.totalChanges === 0}
            >
              <X className="h-3 w-3 mr-2" />
              Discard All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleValidate}
              disabled={summary.totalChanges === 0 || isValidating}
            >
              {isValidating ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3 mr-2" />
              )}
              Validate
            </Button>
            <Button
              size="sm"
              onClick={handleApplyAll}
              disabled={summary.totalChanges === 0 || isApplying}
            >
              {isApplying ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3 mr-2" />
              )}
              Apply All
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});

// ============================================================================
// Tab Components
// ============================================================================

function DataChangesTab({ connectionId }: { connectionId: string }) {
  const summary = useConnectionEditSummary(connectionId);

  // Subscribe to all scopes to ensure reactivity
  const allScopes = useTableEditStore((state) => state.scopes);

  // Get all scopes with data changes
  const scopesWithData = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      rowDrafts: Map<string, any>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const dataDomain = scopeState.domains?.data;
      if (dataDomain && dataDomain.rowDrafts && dataDomain.rowDrafts.size > 0) {
        const [connId, db, schema, table] = scopeKey.split("|||");
        if (connId === connectionId) {
          result.push({
            scope: scopeKey,
            database: db,
            table: table,
            schema: schema,
            rowDrafts: dataDomain.rowDrafts,
          });
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Database className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-sm">No data changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scopesWithData.map((scopeData) => (
        <div key={scopeData.scope} className="space-y-2">
          {/* Table Header */}
          <div className="flex items-center gap-2 pb-2 border-b">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {scopeData.database}.{scopeData.table}
            </span>
            <Badge variant="secondary" className="ml-auto">
              {scopeData.rowDrafts.size} change
              {scopeData.rowDrafts.size !== 1 ? "s" : ""}
            </Badge>
          </div>

          {/* Row Changes */}
          <div className="space-y-2">
            {Array.from(scopeData.rowDrafts.entries()).map(
              ([rowKey, draft]) => (
                <RowChangeCard
                  key={rowKey}
                  rowKey={rowKey}
                  draft={draft}
                  scopeKey={scopeData.scope}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StructureChangesTab({ connectionId }: { connectionId: string }) {
  const summary = useConnectionEditSummary(connectionId);

  // Subscribe to all scopes to ensure reactivity
  const allScopes = useTableEditStore((state) => state.scopes);

  // Get all scopes with structure changes
  const scopesWithStructure = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      editedColumns: Map<string, any>;
      newColumns: Map<string, any>;
      deletedColumns: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const structureDomain = scopeState.domains?.structure;
      if (structureDomain) {
        const hasChanges =
          structureDomain.editedColumns.size > 0 ||
          structureDomain.newColumns.size > 0 ||
          structureDomain.deletedColumns.size > 0;

        if (hasChanges) {
          const [connId, db, schema, table] = scopeKey.split("|||");
          if (connId === connectionId) {
            result.push({
              scope: scopeKey,
              database: db,
              table: table,
              schema: schema,
              editedColumns: structureDomain.editedColumns,
              newColumns: structureDomain.newColumns,
              deletedColumns: structureDomain.deletedColumns,
            });
          }
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithStructure.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Table2 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-sm">No structure changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scopesWithStructure.map((scopeData) => {
        const totalChanges =
          scopeData.editedColumns.size +
          scopeData.newColumns.size +
          scopeData.deletedColumns.size;

        return (
          <div key={scopeData.scope} className="space-y-2">
            {/* Table Header */}
            <div className="flex items-center gap-2 pb-2 border-b">
              <Table2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {scopeData.database}.{scopeData.table}
              </span>
              <Badge variant="secondary" className="ml-auto">
                {totalChanges} change{totalChanges !== 1 ? "s" : ""}
              </Badge>
            </div>

            {/* Column Changes */}
            <div className="space-y-2">
              {/* New Columns */}
              {Array.from(scopeData.newColumns.entries()).map(
                ([colId, column]) => (
                  <ColumnChangeCard
                    key={colId}
                    column={column}
                    action="insert"
                  />
                ),
              )}

              {/* Edited Columns */}
              {Array.from(scopeData.editedColumns.entries()).map(
                ([colName, column]) => (
                  <ColumnChangeCard
                    key={colName}
                    column={column}
                    action="update"
                  />
                ),
              )}

              {/* Deleted Columns */}
              {Array.from(scopeData.deletedColumns).map((colName) => (
                <ColumnChangeCard
                  key={colName}
                  column={{ name: colName }}
                  action="delete"
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ColumnChangeCardProps {
  column: any;
  action: "insert" | "update" | "delete";
}

function ColumnChangeCard({ column, action }: ColumnChangeCardProps) {
  const [expanded, setExpanded] = useState(false);

  const actionBadgeVariant =
    action === "insert"
      ? "default"
      : action === "delete"
      ? "destructive"
      : "secondary";

  const actionLabel =
    action === "insert" ? "ADD" : action === "delete" ? "DROP" : "ALTER";

  // Check if we have original values for showing diffs
  const hasOriginal = column.originalName !== undefined;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs">
            {actionLabel}
          </Badge>
          <span className="text-sm font-mono truncate">
            {column.name || "(unnamed)"}
          </span>
          {column.db_type && (
            <span className="text-xs text-muted-foreground">
              {column.db_type}
            </span>
          )}
        </div>
        {action !== "delete" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        )}
      </div>

      {expanded && action !== "delete" && (
        <div className="pt-2 border-t space-y-2 text-xs">
          {/* Show name change if applicable */}
          {action === "update" &&
            hasOriginal &&
            column.originalName &&
            column.originalName !== column.name && (
              <div className="space-y-1">
                <div className="text-xs font-mono text-muted-foreground">
                  Name
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-2 py-1 bg-destructive/10 text-destructive rounded font-mono truncate">
                    {column.originalName}
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex-1 px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded font-mono truncate">
                    {column.name}
                  </div>
                </div>
              </div>
            )}

          {column.db_type && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">Type:</span>
              <span className="font-mono">{column.db_type}</span>
            </div>
          )}

          {column.nullable !== undefined && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">
                Nullable:
              </span>
              <span>{column.nullable ? "YES" : "NO"}</span>
            </div>
          )}

          {column.default !== undefined && column.default !== null && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">
                Default:
              </span>
              <span className="font-mono">{String(column.default)}</span>
            </div>
          )}

          {column.check_constraint && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">Check:</span>
              <span className="font-mono text-xs">
                {column.check_constraint}
              </span>
            </div>
          )}

          {column.comment && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px]">
                Comment:
              </span>
              <span>{column.comment}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IndexesChangesTab({ connectionId }: { connectionId: string }) {
  const summary = useConnectionEditSummary(connectionId);
  const allScopes = useTableEditStore((state) => state.scopes);

  const scopesWithIndexes = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      editedIndexes: Map<string, any>;
      newIndexes: Map<string, any>;
      deletedIndexes: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const indexesDomain = scopeState.domains?.indexes;
      if (indexesDomain) {
        const hasChanges =
          indexesDomain.editedIndexes.size > 0 ||
          indexesDomain.newIndexes.size > 0 ||
          indexesDomain.deletedIndexes.size > 0;

        if (hasChanges) {
          const [connId, db, schema, table] = scopeKey.split("|||");
          if (connId === connectionId) {
            result.push({
              scope: scopeKey,
              database: db,
              table: table,
              schema: schema,
              editedIndexes: indexesDomain.editedIndexes,
              newIndexes: indexesDomain.newIndexes,
              deletedIndexes: indexesDomain.deletedIndexes,
            });
          }
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithIndexes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Grid3x3 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-sm">No index changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scopesWithIndexes.map((scopeData) => {
        const totalChanges =
          scopeData.editedIndexes.size +
          scopeData.newIndexes.size +
          scopeData.deletedIndexes.size;

        return (
          <div key={scopeData.scope} className="space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Grid3x3 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {scopeData.database}.{scopeData.table}
              </span>
              <Badge variant="secondary" className="ml-auto">
                {totalChanges} change{totalChanges !== 1 ? "s" : ""}
              </Badge>
            </div>

            <div className="space-y-2">
              {Array.from(scopeData.newIndexes.entries()).map(
                ([indexId, index]) => (
                  <IndexChangeCard
                    key={indexId}
                    index={index}
                    action="create"
                  />
                ),
              )}

              {Array.from(scopeData.editedIndexes.entries()).map(
                ([indexName, index]) => (
                  <IndexChangeCard
                    key={indexName}
                    index={index}
                    action="modify"
                  />
                ),
              )}

              {Array.from(scopeData.deletedIndexes).map((indexName) => (
                <IndexChangeCard
                  key={indexName}
                  index={{ name: indexName }}
                  action="drop"
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface IndexChangeCardProps {
  index: any;
  action: "create" | "modify" | "drop";
}

function IndexChangeCard({ index, action }: IndexChangeCardProps) {
  const [expanded, setExpanded] = useState(false);

  const actionBadgeVariant =
    action === "create"
      ? "default"
      : action === "drop"
      ? "destructive"
      : "secondary";

  const actionLabel =
    action === "create" ? "CREATE" : action === "drop" ? "DROP" : "ALTER";

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs">
            {actionLabel}
          </Badge>
          <span className="text-sm font-mono truncate">
            {index.name || "(unnamed)"}
          </span>
        </div>
        {action !== "drop" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        )}
      </div>

      {expanded && action !== "drop" && (
        <div className="pt-2 border-t space-y-2 text-xs">
          {/* Show original vs new for modify actions */}
          {action === "modify" &&
            index.originalName &&
            index.originalName !== index.name && (
              <div className="space-y-1">
                <div className="text-xs font-mono text-muted-foreground">
                  Name
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-2 py-1 bg-destructive/10 text-destructive rounded font-mono truncate">
                    {index.originalName}
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex-1 px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded font-mono truncate">
                    {index.name}
                  </div>
                </div>
              </div>
            )}

          {index.columns && index.columns.length > 0 && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Columns:
              </span>
              <span className="font-mono">
                {Array.isArray(index.columns)
                  ? index.columns.join(", ")
                  : index.columns}
              </span>
            </div>
          )}
          {index.type && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">Type:</span>
              <span>{index.type}</span>
            </div>
          )}
          {index.unique !== undefined && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Unique:
              </span>
              <span>{index.unique ? "YES" : "NO"}</span>
            </div>
          )}
          {index.condition && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Condition:
              </span>
              <span className="font-mono">{index.condition}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TriggersChangesTab({ connectionId }: { connectionId: string }) {
  const summary = useConnectionEditSummary(connectionId);
  const allScopes = useTableEditStore((state) => state.scopes);

  const scopesWithTriggers = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      editedTriggers: Map<string, any>;
      newTriggers: Map<string, any>;
      deletedTriggers: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const triggersDomain = scopeState.domains?.triggers;
      if (triggersDomain) {
        const hasChanges =
          triggersDomain.editedTriggers.size > 0 ||
          triggersDomain.newTriggers.size > 0 ||
          triggersDomain.deletedTriggers.size > 0;

        if (hasChanges) {
          const [connId, db, schema, table] = scopeKey.split("|||");
          if (connId === connectionId) {
            result.push({
              scope: scopeKey,
              database: db,
              table: table,
              schema: schema,
              editedTriggers: triggersDomain.editedTriggers,
              newTriggers: triggersDomain.newTriggers,
              deletedTriggers: triggersDomain.deletedTriggers,
            });
          }
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithTriggers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Zap className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-sm">No trigger changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scopesWithTriggers.map((scopeData) => {
        const totalChanges =
          scopeData.editedTriggers.size +
          scopeData.newTriggers.size +
          scopeData.deletedTriggers.size;

        return (
          <div key={scopeData.scope} className="space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {scopeData.database}.{scopeData.table}
              </span>
              <Badge variant="secondary" className="ml-auto">
                {totalChanges} change{totalChanges !== 1 ? "s" : ""}
              </Badge>
            </div>

            <div className="space-y-2">
              {Array.from(scopeData.newTriggers.entries()).map(
                ([triggerId, trigger]) => (
                  <TriggerChangeCard
                    key={triggerId}
                    trigger={trigger}
                    action="create"
                  />
                ),
              )}

              {Array.from(scopeData.editedTriggers.entries()).map(
                ([triggerName, trigger]) => (
                  <TriggerChangeCard
                    key={triggerName}
                    trigger={trigger}
                    action="modify"
                  />
                ),
              )}

              {Array.from(scopeData.deletedTriggers).map((triggerName) => (
                <TriggerChangeCard
                  key={triggerName}
                  trigger={{ name: triggerName }}
                  action="drop"
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TriggerChangeCardProps {
  trigger: any;
  action: "create" | "modify" | "drop";
}

function TriggerChangeCard({ trigger, action }: TriggerChangeCardProps) {
  const actionBadgeVariant =
    action === "create"
      ? "default"
      : action === "drop"
      ? "destructive"
      : "secondary";

  const actionLabel =
    action === "create" ? "CREATE" : action === "drop" ? "DROP" : "ALTER";

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs">
            {actionLabel}
          </Badge>
          <span className="text-sm font-mono truncate">
            {trigger.name || "(unnamed)"}
          </span>
        </div>
      </div>

      {action !== "drop" && (
        <div className="text-xs space-y-1">
          {trigger.event && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">Event:</span>
              <span>{trigger.event}</span>
            </div>
          )}
          {trigger.timing && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Timing:
              </span>
              <span>{trigger.timing}</span>
            </div>
          )}
          {trigger.function && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Function:
              </span>
              <span className="font-mono">{trigger.function}</span>
            </div>
          )}
          {trigger.enabled !== undefined && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[60px]">
                Enabled:
              </span>
              <span>{trigger.enabled ? "YES" : "NO"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Row Change Card Component
// ============================================================================

interface RowChangeCardProps {
  rowKey: string;
  draft: any; // RowDraft type
  scopeKey: string;
}

function RowChangeCard({ rowKey, draft, scopeKey }: RowChangeCardProps) {
  const [expanded, setExpanded] = useState(false);

  const actionBadgeVariant = useMemo(() => {
    if (draft.action === "insert") return "default";
    if (draft.action === "delete") return "destructive";
    return "secondary";
  }, [draft.action]);

  const actionLabel = useMemo(() => {
    if (draft.action === "insert") return "INSERT";
    if (draft.action === "delete") return "DELETE";
    return "UPDATE";
  }, [draft.action]);

  const changedCellsCount = useMemo(() => {
    return draft.cells?.size || 0;
  }, [draft.cells]);

  // Display row identifier
  const displayRowId = useMemo(() => {
    if (draft.action === "insert") {
      // For new rows, show draft-X
      return rowKey.split(":").pop() || rowKey;
    } else {
      // For existing rows (update/delete), show the actual row ID
      // Row key format is typically "columnName:value" or just the value
      const parts = rowKey.split(":");
      if (parts.length > 1) {
        // Has column prefix, show the value part
        return parts.slice(1).join(":");
      }
      // No prefix, show as is
      return rowKey;
    }
  }, [rowKey, draft.action]);

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs">
            {actionLabel}
          </Badge>
          <span className="text-sm font-mono truncate text-muted-foreground">
            {draft.action === "insert" ? "Row: " : "ID: "}
            {displayRowId}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {draft.action === "update" && changedCellsCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {changedCellsCount} field{changedCellsCount !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-2 pt-2 border-t">
          {draft.action === "delete" && (
            <div className="text-sm text-muted-foreground">
              This row will be deleted
            </div>
          )}

          {draft.action === "insert" && draft.draftRow && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                New Values:
              </div>
              {Object.entries(draft.draftRow).map(
                ([colName, cellValue]: [string, any]) => (
                  <div key={colName} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-muted-foreground min-w-[100px]">
                      {colName}:
                    </span>
                    <span className="font-mono flex-1 truncate">
                      {cellValue?.value !== null &&
                      cellValue?.value !== undefined
                        ? String(cellValue.value)
                        : "NULL"}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}

          {draft.action === "update" && draft.cells && draft.cells.size > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Changed Fields:
              </div>
              {Array.from(draft.cells.entries()).map(
                ([colName, cellDraft]: [string, any]) => {
                  if (!cellDraft.hasChanged) return null;
                  return (
                    <div key={colName} className="space-y-1 pb-2">
                      <div className="text-xs font-mono text-muted-foreground">
                        {colName}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div className="flex-1 px-2 py-1 bg-destructive/10 text-destructive rounded font-mono truncate">
                          {cellDraft.originalValue?.value !== null &&
                          cellDraft.originalValue?.value !== undefined
                            ? String(cellDraft.originalValue.value)
                            : "NULL"}
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <div className="flex-1 px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded font-mono truncate">
                          {cellDraft.draftValue?.value !== null &&
                          cellDraft.draftValue?.value !== undefined
                            ? String(cellDraft.draftValue.value)
                            : "NULL"}
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
