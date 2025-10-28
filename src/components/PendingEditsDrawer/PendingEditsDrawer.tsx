/**
 * Pending Edits Drawer
 *
 * Main preview interface for all pending changes with domain tabs.
 */

import { memo, useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Copy,
  Download,
  Loader2,
} from "lucide-react";
import { useConnectionEditSummary } from "@/stores/tableEditStore.selectors";
import { useTableEditStore, parseScopeKey } from "@/stores/tableEditStore";
import type { ScopeState } from "@/stores/tableEditStore.types";
import type { DomainKind } from "@/utils/changeRecordUtils";
import { useToast } from "@/hooks/use-toast";
import { DiffView } from "./DiffView";
import { cn } from "@/lib/utils";
import { applyChangesService } from "@/services/applyChangesService";
import { sqlPreviewService } from "@/services/sqlPreviewService";

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
  const store = useTableEditStore();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DomainKind>("data");
  const [isValidating, setIsValidating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(() => window.innerWidth * 0.4);
  const [isResizing, setIsResizing] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Debug: Log scope information
  useEffect(() => {
    if (summary.totalChanges > 0) {
      console.log("📊 PendingEditsDrawer summary:", {
        totalChanges: summary.totalChanges,
        scopeCount: summary.scopeCount,
        byScope: Array.from(summary.byScope.entries()).map(
          ([key, scopeSummary]) => ({
            key,
            totalChanges: scopeSummary.totalChanges,
            byDomain: scopeSummary.byDomain,
          }),
        ),
      });

      // Log raw store scopes for this connection
      const rawScopes = Array.from(store.scopes.entries())
        .filter(([key]) => key.startsWith(connectionId))
        .map(([key, scopeState]) => ({
          scopeKey: key,
          dataRowDrafts: scopeState.domains.data.rowDrafts.size,
          structureChanges:
            scopeState.domains.structure.editedColumns.size +
            scopeState.domains.structure.newColumns.size +
            scopeState.domains.structure.deletedColumns.size,
        }));
      console.log("📦 Raw store scopes for connection:", rawScopes);
    }
  }, [summary, connectionId, store.scopes]);

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

    try {
      // Get all scopes from store for this connection
      const allScopes = useTableEditStore.getState().scopes;
      const scopesToApply: Array<{ key: string; state: ScopeState }> = [];

      for (const [scopeKey, scopeState] of allScopes.entries()) {
        if (scopeState.meta.connectionId === connectionId) {
          scopesToApply.push({ key: scopeKey, state: scopeState });
          console.log("🎯 Will apply scope:", scopeKey);
        }
      }

      console.log(`🚀 Applying changes to ${scopesToApply.length} scope(s)`);

      let totalApplied = 0;
      let totalErrors = 0;

      for (const { key, state } of scopesToApply) {
        const parsed = parseScopeKey(key);
        if (!parsed) continue;

        console.log("🚀 Applying scope:", parsed);

        // Determine connection type - assuming PostgreSQL if not found
        const dbType = "postgresql"; // TODO: Get from connection store

        // Apply all changes for this scope
        const result = await applyChangesService.applyScope(
          parsed,
          state,
          dbType,
          {
            domains: ["data", "structure", "indexes", "triggers"],
            continueOnError: true,
          },
        );

        console.log("📊 Apply result:", result);

        if (result.success) {
          // Count applied changes
          const appliedData = result.applied.data
            ? result.applied.data.applied
            : 0;
          const appliedStructure = result.applied.structure
            ? result.applied.structure.applied
            : 0;
          const appliedIndexes = result.applied.indexes
            ? result.applied.indexes.applied
            : 0;
          const appliedTriggers = result.applied.triggers
            ? result.applied.triggers.applied
            : 0;

          totalApplied +=
            appliedData + appliedStructure + appliedIndexes + appliedTriggers;

          // Discard the scope after successful apply
          store.discardScope(parsed);
        } else {
          totalErrors++;
          console.error("❌ Failed to apply scope:", key, result.errors);
        }
      }

      if (totalErrors === 0) {
        toast({
          description: `Successfully applied ${totalApplied} change(s)`,
        });
        onOpenChange(false);
      } else {
        toast({
          description: `Applied ${totalApplied} change(s), ${totalErrors} scope(s) had errors`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("❌ Apply All error:", error);
      toast({
        description: `Failed to apply changes: ${
          error instanceof Error ? error.message : String(error)
        }`,
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }, [connectionId, toast, onOpenChange, store]);

  const handleCopySQL = useCallback(async () => {
    console.log("📋 Copy SQL button clicked");

    try {
      // Get all scopes from store for this connection
      const allScopes = useTableEditStore.getState().scopes;
      const allSql: string[] = [];

      // Determine connection type - assuming PostgreSQL if not found
      const dbType = "postgresql"; // TODO: Get from connection store

      for (const [scopeKey, scopeState] of allScopes.entries()) {
        if (scopeState.meta.connectionId === connectionId) {
          // Skip scopes with no changes
          if (scopeState.summary.totalChanges === 0) {
            console.log("⏭️ Skipping scope with no changes:", scopeKey);
            continue;
          }

          const parsed = parseScopeKey(scopeKey);
          if (!parsed) continue;

          console.log("🔤 Generating SQL for scope:", parsed, {
            totalChanges: scopeState.summary.totalChanges,
            byDomain: scopeState.summary.byDomain,
          });

          // Generate SQL preview for this scope
          const preview = sqlPreviewService.generateScopePreview(
            parsed,
            scopeState,
            dbType,
            {
              domains: ["data", "structure", "indexes", "triggers"],
              includeWarnings: false,
              includeComments: true,
              wrapInTransaction: true,
            },
          );

          // Only include if there are actual SQL statements (not just comments)
          if (preview.statementCount > 0) {
            allSql.push(...preview.sql);
            allSql.push(""); // Add blank line between scopes
          }
        }
      }

      if (allSql.length === 0) {
        toast({
          description: "No SQL to copy",
          variant: "destructive",
        });
        return;
      }

      // Join all SQL and copy to clipboard
      const finalSql = allSql.join("\n");
      await navigator.clipboard.writeText(finalSql);

      toast({
        description: `Copied SQL for ${summary.scopeCount} table(s) to clipboard`,
      });
    } catch (error) {
      console.error("❌ Copy SQL error:", error);
      toast({
        description: `Failed to copy SQL: ${
          error instanceof Error ? error.message : String(error)
        }`,
        variant: "destructive",
      });
    }
  }, [connectionId, toast, summary.scopeCount]);

  const handleExport = useCallback(() => {
    console.log("💾 Export button clicked");
    // TODO: Export changes to file
    toast({
      title: "Export",
      description: "Export not yet implemented",
    });
  }, [toast]);

  const handleDiscardAll = useCallback(() => {
    if (summary.totalChanges === 0) return;
    setShowDiscardConfirm(true);
  }, [summary.totalChanges]);

  const confirmDiscardAll = useCallback(() => {
    console.log("✅ Discarding all changes", {
      totalChanges: summary.totalChanges,
      scopeCount: summary.scopeCount,
    });

    // Discard all scopes for this connection
    const allScopes = Array.from(store.scopes.entries());
    const scopesToDiscard = allScopes
      .filter(([, scopeState]) => scopeState.meta.connectionId === connectionId)
      .map(([scopeKey]) => parseScopeKey(scopeKey))
      .filter(
        (parsed): parsed is NonNullable<typeof parsed> => parsed !== null,
      );

    console.log("🗑️ Discarding scopes:", scopesToDiscard);

    scopesToDiscard.forEach((scope) => {
      // Discard all domains for this scope
      store.discardDomain(scope, "data");
      store.discardDomain(scope, "structure");
      store.discardDomain(scope, "indexes");
      store.discardDomain(scope, "triggers");
    });

    toast({
      description: `Discarded all changes for ${summary.scopeCount} table(s)`,
    });

    setShowDiscardConfirm(false);
    onOpenChange(false);
  }, [summary, connectionId, toast, onOpenChange, store]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = drawerWidth;
    },
    [drawerWidth],
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.max(
        500,
        Math.min(window.innerWidth * 0.9, resizeStartWidth.current + delta),
      );
      setDrawerWidth(newWidth);
    },
    [isResizing],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      return () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
      };
    }
    return undefined;
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="p-0 flex flex-col gap-0 group"
          style={{ width: drawerWidth, maxWidth: "90vw" }}
        >
          {/* Resize Handle */}
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize hover:bg-primary/40 transition-colors z-50",
              isResizing && "bg-primary/40",
            )}
            onMouseDown={handleResizeStart}
            style={{ userSelect: "none" }}
          >
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 group-hover:bg-primary/40 h-16 bg-border rounded-r" />
          </div>

          {/* Header */}
          <SheetHeader className="px-4 py-2">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle>Pending Changes</SheetTitle>
                <SheetDescription>
                  {summary.totalChanges} change
                  {summary.totalChanges !== 1 ? "s" : ""} across{" "}
                  {summary.scopeCount} table
                  {summary.scopeCount !== 1 ? "s" : ""}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-hidden px-4 py-1">
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as DomainKind);
              }}
              className="h-full flex flex-col"
            >
              {/* Tab List */}
              <TabsList className="grid w-full grid-cols-4 p-1">
                <TabsTrigger
                  className="h-6 text-xs !outline-none !ring-0"
                  value="data"
                  disabled={domainCounts.data === 0}
                >
                  <Database className="h-4 w-4 mr-1" />
                  Data
                  {domainCounts.data > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-2 !text-xs !rounded-full"
                    >
                      {domainCounts.data}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="h-6 text-xs !outline-none !ring-0"
                  value="structure"
                  disabled={domainCounts.structure === 0}
                >
                  <Table2 className="h-4 w-4 mr-1" />
                  Structure
                  {domainCounts.structure > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-2 !text-xs !rounded-full"
                    >
                      {domainCounts.structure}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="h-6 text-xs !outline-none !ring-0"
                  value="indexes"
                  disabled={domainCounts.indexes === 0}
                >
                  <Grid3x3 className="h-4 w-4 mr-1" />
                  Indexes
                  {domainCounts.indexes > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-2 !text-xs !rounded-full"
                    >
                      {domainCounts.indexes}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="h-6 text-xs !outline-none !ring-0"
                  value="triggers"
                  disabled={domainCounts.triggers === 0}
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Triggers
                  {domainCounts.triggers > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-2 !text-xs !rounded-full"
                    >
                      {domainCounts.triggers}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Tab Content */}
              <div className="flex-1 overflow-auto py-2">
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
          <div className="border-t p-2 flex items-center justify-between gap-2 bg-muted/30">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={handleCopySQL}
                disabled={summary.totalChanges === 0}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy SQL
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={handleExport}
                disabled={summary.totalChanges === 0}
              >
                <Download className="h-3 w-3 mr-1" />
                Export
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={handleDiscardAll}
                disabled={summary.totalChanges === 0}
              >
                <X className="h-3 w-3 mr-1" />
                Discard All
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={handleValidate}
                disabled={summary.totalChanges === 0 || isValidating}
              >
                {isValidating ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-3 w-3 mr-1" />
                )}
                Validate
              </Button>
              <Button
                size="xs"
                onClick={handleApplyAll}
                disabled={summary.totalChanges === 0 || isApplying}
              >
                {isApplying ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-3 w-3 mr-1" />
                )}
                Apply All
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard All Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard all {summary.totalChanges}{" "}
              pending change(s) across {summary.scopeCount} table(s)? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscardAll}>
              Discard All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

// ============================================================================
// Tab Components
// ============================================================================

function DataChangesTab({ connectionId }: { connectionId: string }) {
  // Subscribe to all scopes to ensure reactivity
  const allScopes = useTableEditStore((state) => state.scopes);

  // Get all scopes with data changes
  const scopesWithData = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rowDrafts: Map<string, any>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const dataDomain = scopeState.domains.data;
      if (dataDomain.rowDrafts.size > 0) {
        const parts = scopeKey.split("|||");
        const connId = parts[0] ?? "";
        const db = parts[1] ?? "";
        const schema = parts[2] ?? "";
        const table = parts[3] ?? "";

        if (connId === connectionId) {
          result.push({
            scope: scopeKey,
            database: db,
            table,
            schema,
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
        <p className="text-xs">No data changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scopesWithData.map((scopeData) => (
        <div key={scopeData.scope} className="space-y-1.5">
          {/* Table Header */}
          <div className="flex items-center gap-2 pb-2 border-b">
            <Database className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-xs">
              {scopeData.schema}.{scopeData.table}
            </span>
            <Badge variant="secondary" className="ml-auto">
              {scopeData.rowDrafts.size} change
              {scopeData.rowDrafts.size !== 1 ? "s" : ""}
            </Badge>
          </div>

          {/* Row Changes */}
          <div className="space-y-1">
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
  // Subscribe to all scopes to ensure reactivity
  const allScopes = useTableEditStore((state) => state.scopes);

  // Get all scopes with structure changes
  const scopesWithStructure = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editedColumns: Map<string, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newColumns: Map<string, any>;
      deletedColumns: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const structureDomain = scopeState.domains.structure;
      const hasChanges =
        structureDomain.editedColumns.size > 0 ||
        structureDomain.newColumns.size > 0 ||
        structureDomain.deletedColumns.size > 0;

      if (hasChanges) {
        const parts = scopeKey.split("|||");
        const connId = parts[0] ?? "";
        const db = parts[1] ?? "";
        const schema = parts[2] ?? "";
        const table = parts[3] ?? "";

        if (connId === connectionId) {
          result.push({
            scope: scopeKey,
            database: db,
            table,
            schema,
            editedColumns: structureDomain.editedColumns,
            newColumns: structureDomain.newColumns,
            deletedColumns: structureDomain.deletedColumns,
          });
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithStructure.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Table2 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-xs">No structure changes</p>
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
                {scopeData.schema}.{scopeData.table}
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
                    scopeKey={scopeData.scope}
                    columnKey={colId}
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
                    scopeKey={scopeData.scope}
                    columnKey={colName}
                  />
                ),
              )}

              {/* Deleted Columns */}
              {Array.from(scopeData.deletedColumns).map((colName) => (
                <ColumnChangeCard
                  key={colName}
                  column={{ name: colName }}
                  action="delete"
                  scopeKey={scopeData.scope}
                  columnKey={colName}
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any;
  action: "insert" | "update" | "delete";
  scopeKey: string;
  columnKey: string;
}

function ColumnChangeCard({
  column,
  action,
  scopeKey,
  columnKey,
}: ColumnChangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const store = useTableEditStore();
  const parsed = useMemo(() => parseScopeKey(scopeKey), [scopeKey]);

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

  const handleDiscard = useCallback(() => {
    if (!parsed) return;
    store.removeChange(parsed, "structure", columnKey);
  }, [parsed, columnKey, store]);

  return (
    <div className="border rounded p-2 space-y-1.5 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs h-5 px-1.5">
            {actionLabel}
          </Badge>
          <span className="text-xs font-mono truncate">
            {column.name || "(unnamed)"}
          </span>
          {column.db_type && (
            <span className="text-xs text-muted-foreground">
              {column.db_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {action !== "delete" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDiscard}
            title="Discard this change"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
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
  const allScopes = useTableEditStore((state) => state.scopes);

  const scopesWithIndexes = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editedIndexes: Map<string, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newIndexes: Map<string, any>;
      deletedIndexes: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const indexesDomain = scopeState.domains.indexes;
      const hasChanges =
        indexesDomain.editedIndexes.size > 0 ||
        indexesDomain.newIndexes.size > 0 ||
        indexesDomain.deletedIndexes.size > 0;

      if (hasChanges) {
        const parts = scopeKey.split("|||");
        const connId = parts[0] ?? "";
        const db = parts[1] ?? "";
        const schema = parts[2] ?? "";
        const table = parts[3] ?? "";

        if (connId === connectionId) {
          result.push({
            scope: scopeKey,
            database: db,
            table,
            schema,
            editedIndexes: indexesDomain.editedIndexes,
            newIndexes: indexesDomain.newIndexes,
            deletedIndexes: indexesDomain.deletedIndexes,
          });
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithIndexes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Grid3x3 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-xs">No index changes</p>
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
              <span className="font-medium text-xs">
                {scopeData.schema}.{scopeData.table}
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
                    scopeKey={scopeData.scope}
                    indexKey={indexId}
                  />
                ),
              )}

              {Array.from(scopeData.editedIndexes.entries()).map(
                ([indexName, index]) => (
                  <IndexChangeCard
                    key={indexName}
                    index={index}
                    action="modify"
                    scopeKey={scopeData.scope}
                    indexKey={indexName}
                  />
                ),
              )}

              {Array.from(scopeData.deletedIndexes).map((indexName) => (
                <IndexChangeCard
                  key={indexName}
                  index={{ name: indexName }}
                  action="drop"
                  scopeKey={scopeData.scope}
                  indexKey={indexName}
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  index: any;
  action: "create" | "modify" | "drop";
  scopeKey: string;
  indexKey: string;
}

function IndexChangeCard({
  index,
  action,
  scopeKey,
  indexKey,
}: IndexChangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const store = useTableEditStore();
  const parsed = useMemo(() => parseScopeKey(scopeKey), [scopeKey]);

  const actionBadgeVariant =
    action === "create"
      ? "default"
      : action === "drop"
      ? "destructive"
      : "secondary";

  const actionLabel =
    action === "create" ? "CREATE" : action === "drop" ? "DROP" : "ALTER";

  const handleDiscard = useCallback(() => {
    if (!parsed) return;
    store.removeChange(parsed, "indexes", indexKey);
  }, [parsed, indexKey, store]);

  return (
    <div className="border rounded p-2 space-y-1.5 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs h-5 px-1.5">
            {actionLabel}
          </Badge>
          <span className="text-xs font-mono truncate">
            {index.name || "(unnamed)"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {action !== "drop" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDiscard}
            title="Discard this change"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
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
  const allScopes = useTableEditStore((state) => state.scopes);

  const scopesWithTriggers = useMemo(() => {
    const result: Array<{
      scope: string;
      database: string;
      table: string;
      schema: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editedTriggers: Map<string, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newTriggers: Map<string, any>;
      deletedTriggers: Set<string>;
    }> = [];

    for (const [scopeKey, scopeState] of allScopes.entries()) {
      const triggersDomain = scopeState.domains.triggers;
      const hasChanges =
        triggersDomain.editedTriggers.size > 0 ||
        triggersDomain.newTriggers.size > 0 ||
        triggersDomain.deletedTriggers.size > 0;

      if (hasChanges) {
        const parts = scopeKey.split("|||");
        const connId = parts[0] ?? "";
        const db = parts[1] ?? "";
        const schema = parts[2] ?? "";
        const table = parts[3] ?? "";

        if (connId === connectionId) {
          result.push({
            scope: scopeKey,
            database: db,
            table,
            schema,
            editedTriggers: triggersDomain.editedTriggers,
            newTriggers: triggersDomain.newTriggers,
            deletedTriggers: triggersDomain.deletedTriggers,
          });
        }
      }
    }

    return result;
  }, [connectionId, allScopes]);

  if (scopesWithTriggers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Zap className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-xs">No trigger changes</p>
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
              <span className="font-medium text-xs">
                {scopeData.schema}.{scopeData.table}
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
                    scopeKey={scopeData.scope}
                    triggerKey={triggerId}
                  />
                ),
              )}

              {Array.from(scopeData.editedTriggers.entries()).map(
                ([triggerName, trigger]) => (
                  <TriggerChangeCard
                    key={triggerName}
                    trigger={trigger}
                    action="modify"
                    scopeKey={scopeData.scope}
                    triggerKey={triggerName}
                  />
                ),
              )}

              {Array.from(scopeData.deletedTriggers).map((triggerName) => (
                <TriggerChangeCard
                  key={triggerName}
                  trigger={{ name: triggerName }}
                  action="drop"
                  scopeKey={scopeData.scope}
                  triggerKey={triggerName}
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trigger: any;
  action: "create" | "modify" | "drop";
  scopeKey: string;
  triggerKey: string;
}

function TriggerChangeCard({
  trigger,
  action,
  scopeKey,
  triggerKey,
}: TriggerChangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const store = useTableEditStore();
  const parsed = useMemo(() => parseScopeKey(scopeKey), [scopeKey]);

  const actionBadgeVariant =
    action === "create"
      ? "default"
      : action === "drop"
      ? "destructive"
      : "secondary";

  const actionLabel =
    action === "create" ? "CREATE" : action === "drop" ? "DROP" : "ALTER";

  const handleDiscard = useCallback(() => {
    if (!parsed) return;
    store.removeChange(parsed, "triggers", triggerKey);
  }, [parsed, triggerKey, store]);

  return (
    <div className="border rounded p-2 space-y-1.5 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs h-5 px-1.5">
            {actionLabel}
          </Badge>
          <span className="text-xs font-mono truncate">
            {trigger.name || "(unnamed)"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {action !== "drop" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDiscard}
            title="Discard this change"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {expanded && action !== "drop" && (
        <div className="pt-1.5 border-t space-y-1 text-xs">
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draft: any;
  scopeKey: string;
}

function RowChangeCard({ rowKey, draft, scopeKey }: RowChangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const store = useTableEditStore();
  const parsed = useMemo(() => parseScopeKey(scopeKey), [scopeKey]);

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

  const handleDiscard = useCallback(() => {
    if (parsed) {
      store.removeChange(parsed, "data", rowKey);
    }
  }, [parsed, rowKey, store]);

  // Display row identifier
  const displayRowId = useMemo(() => {
    if (draft.action === "insert") {
      // For new rows, show draft-X
      return rowKey.split(":").pop() || rowKey;
    } else {
      // For existing rows (update/delete), show the actual row ID
      // Row key format: "schema.table:pk:primaryKeyValue" or "schema.table:draft-X"
      const parts = rowKey.split(":");

      if (parts.length >= 3 && parts[1] === "pk") {
        // Has "pk" prefix, show the primary key value(s)
        return parts.slice(2).join(":");
      } else if (parts.length > 1) {
        // Fallback: show everything after first colon
        return parts.slice(1).join(":");
      }
      // No prefix, show as is
      return rowKey;
    }
  }, [rowKey, draft.action]);

  return (
    <div className="border rounded p-1.5 space-y-1 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Badge variant={actionBadgeVariant} className="text-xs h-5 px-1.5">
            {actionLabel}
          </Badge>
          <span className="text-xs font-mono truncate text-muted-foreground">
            {draft.action === "insert" ? "Row: " : "ID: "}
            {displayRowId}
          </span>
          {draft.action === "update" && changedCellsCount > 0 && (
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {changedCellsCount} field{changedCellsCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDiscard}
            title="Discard this change"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="space-y-1 pt-1 border-t">
          {draft.action === "delete" && (
            <div className="text-xs text-muted-foreground">
              This row will be deleted
            </div>
          )}

          {draft.action === "insert" && draft.draftRow && (
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-muted-foreground mb-1">
                New Values:
              </div>
              {/* eslint-disable-next-line @typescript-eslint/no-unsafe-argument */}
              {Object.entries(draft.draftRow).map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ([colName, cellValue]: [string, any]) => (
                  <div
                    key={colName}
                    className="flex items-start gap-1.5 text-xs"
                  >
                    <span className="font-mono text-muted-foreground min-w-[80px]">
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
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">
                Changed Fields:
              </div>
              {Array.from(draft.cells.entries()).map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ([colName, cellDraft]: [string, any]) => {
                  if (!cellDraft.hasChanged) return null;
                  return (
                    <div key={colName} className="space-y-0.5 pb-0.5">
                      <div className="text-[10px] font-mono font-medium text-muted-foreground">
                        {colName}
                      </div>
                      <DiffView
                        before={cellDraft.originalValue?.value}
                        after={cellDraft.draftValue?.value}
                      />
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
