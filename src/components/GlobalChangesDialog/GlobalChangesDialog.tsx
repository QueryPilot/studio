import { logger } from "@/lib/logger";
import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type { CrudCommand } from "@/types/crud";
import { DbType } from "@/types/connection";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { useValidationStore } from "@/stores/validationStore";
import { getOperationExecutor } from "@/services/operationExecutors";
import {
  CodeEditor,
  type SqlDialect,
  type CodeEditorLanguage,
} from "@/components/CodeEditor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCircleCheckFilled,
  IconX,
  IconLoader2,
  IconArrowBackUp,
  IconAlertTriangle,
  IconCode,
  IconList,
  IconCopy,
  IconCheck,
  IconRefresh,
  IconShieldCheck,
  IconChevronLeft,
  IconChevronDown,
  IconChevronRight,
  IconTable,
} from "@tabler/icons-react";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useTheme } from "next-themes";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// Map DbType to CodeEditor language and dialect
const dbTypeToDialect: Record<DbType, SqlDialect> = {
  [DbType.PostgreSQL]: "postgresql",
  [DbType.MySQL]: "mysql",
  [DbType.MariaDB]: "mysql", // MariaDB uses MySQL syntax
  [DbType.SQLite]: "sqlite",
  [DbType.DuckDB]: "postgresql",
  [DbType.MotherDuck]: "postgresql",
  [DbType.SQLServer]: "mssql",
  [DbType.Oracle]: "oracle",
  [DbType.MongoDB]: "postgresql",
  [DbType.Redis]: "postgresql",
  [DbType.Trino]: "trino",
};

const dbTypeToEditorLanguage: Record<DbType, CodeEditorLanguage> = {
  [DbType.PostgreSQL]: "sql",
  [DbType.MySQL]: "sql",
  [DbType.MariaDB]: "sql",
  [DbType.SQLite]: "sql",
  [DbType.DuckDB]: "sql",
  [DbType.MotherDuck]: "sql",
  [DbType.SQLServer]: "sql",
  [DbType.Oracle]: "sql",
  [DbType.MongoDB]: "json",
  [DbType.Redis]: "redis",
  [DbType.Trino]: "sql",
};

interface GlobalChangesDialogProps {
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}

interface GroupedRowChange {
  rowKey: string;
  tableName: string;
  commands: CrudCommand[];
}

interface TableSummary {
  tableKey: string;
  displayName: string;
  total: number;
  inserts: number;
  updates: number;
  deletes: number;
  ddl: number;
}

interface ConnectionGroup {
  connectionId: string;
  connectionName: string;
  dbType: DbType;
  tables: TableSummary[];
  totalChanges: number;
}

interface DerivedChangesData {
  groupedByRow: GroupedRowChange[];
  tableSummaries: TableSummary[];
  tableNameByKey: Map<string, string>;
  totalChanges: number;
}

function isSchemaChangingCommand(command: CrudCommand): boolean {
  return (
    command.type === "table.create" ||
    command.type === "table.drop" ||
    command.type === "table.duplicate" ||
    command.type === "table.truncate" ||
    command.type === "table.rename" ||
    command.type === "view.create" ||
    command.type === "view.drop" ||
    command.type === "sequence.create" ||
    command.type === "sequence.drop"
  );
}

/**
 * Filter out incomplete commands that shouldn't appear in the preview.
 * E.g. newly added index rows that haven't been named or given columns yet.
 */
function filterIncompleteCommands(commands: CrudCommand[]): CrudCommand[] {
  return commands.filter((cmd) => {
    if (cmd.type === "index.create") {
      const def = (
        cmd.payload as { definition?: { name?: string; columns?: string[] } }
      ).definition;
      if (!def?.name || !def.columns?.length) return false;
    }
    return true;
  });
}

// For sidebar context: show schema.table (omit database since connection header already provides context)
function getSidebarTableName(tableKey: string): string {
  const parts = tableKey.split(":");
  // Format: connectionId:database:schema:table
  if (parts.length >= 4) {
    const schema = parts[2];
    const table = parts.slice(3).join(":");
    return schema ? `${schema}.${table}` : table;
  }
  return parts[parts.length - 1] || "unknown";
}

function getDisplayTableName(tableKey: string, fallback = "unknown"): string {
  const parts = tableKey.split(":");
  const tableName =
    parts.slice(3).join(":") || parts[parts.length - 1] || fallback;
  const databaseName = parts.length > 3 ? parts[1] : undefined;
  const schemaName = parts.length > 3 ? parts[2] : undefined;

  if (databaseName && schemaName) {
    return `${databaseName}.${schemaName}.${tableName}`;
  }

  if (schemaName) {
    return `${schemaName}.${tableName}`;
  }

  return tableName;
}

function getRowKeyForCommand(command: CrudCommand): string {
  if (command.type === "data.insert") {
    return `insert-${command.id}`;
  }
  if (command.type === "data.update") {
    const payload = command.payload as {
      primaryKeys?: Record<string, unknown>;
    };
    return payload.primaryKeys
      ? JSON.stringify(payload.primaryKeys)
      : `update-${command.id}`;
  }
  if (command.type === "data.delete") {
    const payload = command.payload as {
      primaryKeys?: Record<string, unknown>;
    };
    return payload.primaryKeys
      ? JSON.stringify(payload.primaryKeys)
      : `delete-${command.id}`;
  }
  return command.id;
}

function createEmptyDerivedChangesData(): DerivedChangesData {
  return {
    groupedByRow: [],
    tableSummaries: [],
    tableNameByKey: new Map(),
    totalChanges: 0,
  };
}

function buildDerivedChangesData(
  connectionCommands: Array<[string, CrudCommand[]]>,
): DerivedChangesData {
  const groupedRows: GroupedRowChange[] = [];
  const rowMap = new Map<string, CrudCommand[]>();
  const tableNameByKeyMap = new Map<string, string>();
  const summaryRows: TableSummary[] = [];
  let changeCount = 0;

  for (const [tableKey, commands] of connectionCommands) {
    const displayName = getDisplayTableName(tableKey);
    tableNameByKeyMap.set(tableKey, displayName);

    let inserts = 0;
    let updates = 0;
    let deletes = 0;

    for (const command of commands) {
      changeCount++;
      if (command.type === "data.insert") {
        inserts++;
      } else if (command.type === "data.update") {
        updates++;
      } else if (command.type === "data.delete") {
        deletes++;
      }

      const rowKey = `${tableKey}::${getRowKeyForCommand(command)}`;
      let rowCommands = rowMap.get(rowKey);
      if (!rowCommands) {
        rowCommands = [];
        rowMap.set(rowKey, rowCommands);
        groupedRows.push({
          rowKey,
          tableName: displayName,
          commands: rowCommands,
        });
      }
      rowCommands.push(command);
    }

    summaryRows.push({
      tableKey,
      displayName,
      total: commands.length,
      inserts,
      updates,
      deletes,
      ddl: commands.length - inserts - updates - deletes,
    });
  }

  return {
    groupedByRow: groupedRows,
    tableSummaries: summaryRows,
    tableNameByKey: tableNameByKeyMap,
    totalChanges: changeCount,
  };
}

export function GlobalChangesDialog(props: GlobalChangesDialogProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    open,
    onOpenChange,
    onCommitSuccess,
  } = props;

  // Only subscribe to stagedCommands when dialog is open (#11 fix)
  // When closed, return stable empty Map so Zustand doesn't trigger re-renders
  const EMPTY_MAP = useMemo(() => new Map<string, never[]>(), []);
  const stagedCommands = useCrudStore((state) =>
    open ? state.stagedCommands : EMPTY_MAP,
  );
  const discardAll = useCrudStore((state) => state.discardAll);
  const getTableKey = useCrudStore((state) => state.getTableKey);
  const commitChanges = useCrudStore((state) => state.commitChanges);
  const discardChanges = useCrudStore((state) => state.discardChanges);
  const unstageCommand = useCrudStore((state) => state.unstageCommand);
  const clearCommittedChanges = useCrudStore(
    (state) => state.clearCommittedChanges,
  );
  const isCommittingAll = useCrudStore((state) => state.isCommittingAll);

  // Local committing state for dialog-initiated commits
  const [isCommittingLocal, setIsCommittingLocal] = useState(false);
  // Combined: either dialog is committing OR global Cmd+S is committing
  const isCommitting = isCommittingLocal || isCommittingAll;
  const [viewMode, setViewMode] = useState<"changes" | "ddl">("changes");
  const [copiedSql, setCopiedSql] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  // Selected table in sidebar (null = show all tables)
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  // Collapsible connection groups in sidebar (tracks which are expanded)
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(
    new Set(),
  );

  // Defer heavy computation until after the dialog shell has painted.
  // This prevents the UI from freezing when opening with thousands of commands.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    // Schedule after the browser has painted the dialog shell
    const raf = requestAnimationFrame(() => {
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // Get connection for database type
  const connections = useConnectionStore((state) => state.connections);
  const connection = useMemo(() => {
    if (!connectionId) {
      return undefined;
    }
    return connections.find(
      (candidate) => candidate.profile.id === connectionId,
    );
  }, [connectionId, connections]);
  const dbType: DbType = connection
    ? connection.profile.db_type
    : DbType.PostgreSQL;

  // Validation store for checking errors
  const { canCommit } = useValidationStore();

  // Check if this is table-specific or workspace-wide
  const isTableSpecific = database !== undefined && table !== undefined;
  const isWorkspaceWide = connectionId === undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (isTableSpecific && !connectionId) {
      logger.error(
        "[GlobalChangesDialog] Invalid table-specific scope: missing connectionId",
      );
      toast.error(
        "Internal error: missing connection context for table-specific changes",
      );
      onOpenChange(false);
    }
  }, [open, isTableSpecific, connectionId, onOpenChange]);

  // Filter commands based on scope - memoize to prevent unnecessary recalculations
  // Skip computation until dialog is open AND ready (after first paint)
  const connectionCommands = useMemo<Array<[string, CrudCommand[]]>>(() => {
    if (!open || !ready) {
      return [];
    }

    // Table-specific mode should not scan all tables. Fetch directly by table key.
    if (isTableSpecific) {
      if (!connectionId) {
        return [];
      }
      const tableKey = getTableKey({
        connectionId,
        database: database,
        schema,
        table: table,
      });
      const commands = stagedCommands.get(tableKey);
      if (!commands) return [];
      const complete = filterIncompleteCommands(commands);
      return complete.length > 0 ? [[tableKey, complete]] : [];
    }

    const filtered: Array<[string, CrudCommand[]]> = [];
    for (const [tableKey, commands] of stagedCommands.entries()) {
      const shouldInclude = connectionId
        ? tableKey.startsWith(`${connectionId}:`)
        : true;
      if (!shouldInclude) continue;
      const complete = filterIncompleteCommands(commands);
      if (complete.length > 0) {
        filtered.push([tableKey, complete]);
      }
    }

    return filtered;
  }, [
    open,
    ready,
    stagedCommands,
    isTableSpecific,
    getTableKey,
    connectionId,
    database,
    schema,
    table,
  ]);

  // Keep parent open state in sync when undo/discard removes every staged command.
  // Without this, the dialog unmounts while `open` stays true and reappears on next edit.
  useEffect(() => {
    if (open && ready && connectionCommands.length === 0) {
      onOpenChange(false);
    }
  }, [open, ready, connectionCommands.length, onOpenChange]);

  const [derivedData, setDerivedData] = useState<DerivedChangesData>(
    createEmptyDerivedChangesData,
  );
  const [isDerivingChanges, setIsDerivingChanges] = useState(false);

  useEffect(() => {
    if (connectionCommands.length === 0) {
      setDerivedData(createEmptyDerivedChangesData());
      setIsDerivingChanges(false);
      return;
    }

    const totalCommandCount = connectionCommands.reduce(
      (sum, [, commands]) => sum + commands.length,
      0,
    );
    const SHOULD_CHUNK_THRESHOLD = 2000;

    if (totalCommandCount < SHOULD_CHUNK_THRESHOLD) {
      setDerivedData(buildDerivedChangesData(connectionCommands));
      setIsDerivingChanges(false);
      return;
    }

    setIsDerivingChanges(true);

    let cancelled = false;
    let rafId = 0;

    const groupedRows: GroupedRowChange[] = [];
    const rowMap = new Map<string, CrudCommand[]>();
    const tableNameByKeyMap = new Map<string, string>();
    const summaryRows: TableSummary[] = [];

    let changeCount = 0;
    let tableIndex = 0;
    let commandIndex = 0;
    let currentSummary: {
      tableKey: string;
      displayName: string;
      total: number;
      inserts: number;
      updates: number;
      deletes: number;
    } | null = null;
    let currentCommands: CrudCommand[] | null = null;
    let currentDisplayName = "";

    const processChunk = () => {
      if (cancelled) {
        return;
      }

      const startTime = performance.now();
      const FRAME_BUDGET_MS = 8;

      while (tableIndex < connectionCommands.length) {
        const [tableKey, commands] = connectionCommands[tableIndex] ?? [];
        if (!tableKey || !commands) {
          tableIndex++;
          commandIndex = 0;
          currentSummary = null;
          currentCommands = null;
          continue;
        }

        if (commandIndex === 0) {
          currentDisplayName = getDisplayTableName(tableKey);
          tableNameByKeyMap.set(tableKey, currentDisplayName);
          currentCommands = commands;
          currentSummary = {
            tableKey,
            displayName: currentDisplayName,
            total: commands.length,
            inserts: 0,
            updates: 0,
            deletes: 0,
          };
        }

        const commandsToProcess = currentCommands ?? commands;
        while (commandIndex < commandsToProcess.length) {
          const command = commandsToProcess[commandIndex];
          if (!command) {
            commandIndex++;
            continue;
          }

          changeCount++;
          if (command.type === "data.insert") {
            if (currentSummary) currentSummary.inserts++;
          } else if (command.type === "data.update") {
            if (currentSummary) currentSummary.updates++;
          } else if (command.type === "data.delete") {
            if (currentSummary) currentSummary.deletes++;
          }

          const rowKey = `${tableKey}::${getRowKeyForCommand(command)}`;
          let rowCommands = rowMap.get(rowKey);
          if (!rowCommands) {
            rowCommands = [];
            rowMap.set(rowKey, rowCommands);
            groupedRows.push({
              rowKey,
              tableName: currentDisplayName,
              commands: rowCommands,
            });
          }
          rowCommands.push(command);

          commandIndex++;

          if (performance.now() - startTime >= FRAME_BUDGET_MS) {
            rafId = requestAnimationFrame(processChunk);
            return;
          }
        }

        if (currentSummary) {
          summaryRows.push({
            tableKey: currentSummary.tableKey,
            displayName: currentSummary.displayName,
            total: currentSummary.total,
            inserts: currentSummary.inserts,
            updates: currentSummary.updates,
            deletes: currentSummary.deletes,
            ddl:
              currentSummary.total -
              currentSummary.inserts -
              currentSummary.updates -
              currentSummary.deletes,
          });
        }

        tableIndex++;
        commandIndex = 0;
        currentSummary = null;
        currentCommands = null;
      }

      setDerivedData({
        groupedByRow: groupedRows,
        tableSummaries: summaryRows,
        tableNameByKey: tableNameByKeyMap,
        totalChanges: changeCount,
      });
      setIsDerivingChanges(false);
    };

    rafId = requestAnimationFrame(processChunk);

    return () => {
      cancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [connectionCommands]);

  const { groupedByRow, tableSummaries, tableNameByKey, totalChanges } =
    derivedData;

  const filteredGroupedByRow = useMemo(() => {
    let filtered = groupedByRow;

    if (selectedConnectionId) {
      filtered = filtered.filter((row) => {
        const command = row.commands[0];
        return command?.target.connectionId === selectedConnectionId;
      });
    }

    if (selectedTableKey) {
      filtered = filtered.filter((row) =>
        row.rowKey.startsWith(`${selectedTableKey}::`),
      );
    }

    return filtered;
  }, [groupedByRow, selectedConnectionId, selectedTableKey]);

  // Calculate validation errors across all tables in scope
  const validationStatus = useMemo(() => {
    let totalErrors = 0;
    const tableErrorMap: Record<string, number> = {};

    for (const [tableKey] of connectionCommands) {
      const { allowed, errorCount } = canCommit(tableKey);
      if (!allowed) {
        totalErrors += errorCount;
        const displayName =
          tableNameByKey.get(tableKey) ?? getDisplayTableName(tableKey);
        tableErrorMap[displayName] = errorCount;
      }
    }

    return {
      canCommitAll: totalErrors === 0,
      totalErrors,
      tableErrors: tableErrorMap,
    };
  }, [connectionCommands, canCommit, tableNameByKey]);

  const connectionGroups = useMemo<ConnectionGroup[]>(() => {
    if (!isWorkspaceWide) {
      return [];
    }

    const groupMap = new Map<
      string,
      { tables: TableSummary[]; total: number }
    >();

    for (const summary of tableSummaries) {
      const [connId] = summary.tableKey.split(":");
      if (!connId) {
        continue;
      }

      let group = groupMap.get(connId);
      if (!group) {
        group = { tables: [], total: 0 };
        groupMap.set(connId, group);
      }
      group.tables.push(summary);
      group.total += summary.total;
    }

    const groups: ConnectionGroup[] = [];
    for (const [connId, group] of groupMap) {
      const conn = connections.find(
        (candidate) => candidate.profile.id === connId,
      );
      groups.push({
        connectionId: connId,
        connectionName: conn ? conn.profile.name : connId.slice(0, 8),
        dbType: conn ? conn.profile.db_type : DbType.PostgreSQL,
        tables: group.tables,
        totalChanges: group.total,
      });
    }

    return groups;
  }, [isWorkspaceWide, tableSummaries, connections]);

  // Expand all connections when dialog opens and data is loaded.
  // Uses connectionGroups.length (primitive) instead of the array reference
  // so adding rows to an existing connection doesn't reset user's collapse state.
  const connectionGroupCount = connectionGroups.length;
  useEffect(() => {
    if (!open || connectionGroupCount === 0) return;
    setSelectedConnectionId(null);
    setSelectedTableKey(null);
    setExpandedConnections(
      new Set(connectionGroups.map((g) => g.connectionId)),
    );
  }, [open, connectionGroupCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedConnectionId) {
      return;
    }
    const exists = tableSummaries.some((summary) =>
      summary.tableKey.startsWith(`${selectedConnectionId}:`),
    );
    if (!exists) {
      setSelectedConnectionId(null);
      setSelectedTableKey(null);
    }
  }, [selectedConnectionId, tableSummaries]);

  useEffect(() => {
    if (!selectedTableKey) {
      return;
    }
    if (!tableNameByKey.has(selectedTableKey)) {
      setSelectedTableKey(null);
    }
  }, [selectedTableKey, tableNameByKey]);

  // Generate SQL from staged commands (async) — deferred until SQL tab is active
  const [generatedSQL, setGeneratedSQL] = useState<string>(
    "-- Click the DDL tab to generate preview",
  );
  const [sqlGenerated, setSqlGenerated] = useState(false);
  const ddlPreviewCommands = useMemo<CrudCommand[]>(() => {
    return filteredGroupedByRow.flatMap((row) => row.commands);
  }, [filteredGroupedByRow]);

  const ddlEditorLanguage = useMemo<CodeEditorLanguage>(() => {
    if (!isWorkspaceWide) {
      return dbTypeToEditorLanguage[dbType];
    }

    const connectionIds = new Set(
      ddlPreviewCommands.map((command) => command.target.connectionId),
    );
    const languages = new Set<CodeEditorLanguage>();

    for (const connId of connectionIds) {
      const conn = connections.find(
        (candidate) => candidate.profile.id === connId,
      );
      const connDbType = conn ? conn.profile.db_type : DbType.PostgreSQL;
      languages.add(dbTypeToEditorLanguage[connDbType]);
    }

    if (languages.size === 1) {
      const [singleLanguage] = languages;
      if (singleLanguage) {
        return singleLanguage;
      }
    }

    return "text";
  }, [isWorkspaceWide, dbType, ddlPreviewCommands, connections]);

  useEffect(() => {
    // Only generate when the SQL tab is selected (avoid blocking on dialog open)
    if (viewMode !== "ddl") return;
    // Don't regenerate if already generated for the same commands
    if (sqlGenerated) return;

    const generatePreview = async () => {
      setGeneratedSQL("-- Generating preview...");

      if (ddlPreviewCommands.length === 0) {
        setGeneratedSQL("-- No changes to commit");
        setSqlGenerated(true);
        return;
      }

      try {
        const commandsByConnection = new Map<string, CrudCommand[]>();
        for (const command of ddlPreviewCommands) {
          const connId = command.target.connectionId;
          let list = commandsByConnection.get(connId);
          if (!list) {
            list = [];
            commandsByConnection.set(connId, list);
          }
          list.push(command);
        }

        if (commandsByConnection.size === 1) {
          const singleEntry = commandsByConnection.entries().next().value;
          if (!singleEntry) {
            setGeneratedSQL("-- No changes to commit");
            setSqlGenerated(true);
            return;
          }

          const [connId, commands] = singleEntry;
          const conn = connections.find(
            (candidate) => candidate.profile.id === connId,
          );
          const connDbType = conn ? conn.profile.db_type : DbType.PostgreSQL;
          const executor = await getOperationExecutor(connId, connDbType);
          const preview = executor.preview(commands);
          setGeneratedSQL(preview.content);
          setSqlGenerated(true);
          return;
        }

        const sections: string[] = [];
        for (const [connId, commands] of commandsByConnection) {
          const conn = connections.find(
            (candidate) => candidate.profile.id === connId,
          );
          const connName = conn ? conn.profile.name : connId.slice(0, 8);
          const connDbType = conn ? conn.profile.db_type : DbType.PostgreSQL;
          const executor = await getOperationExecutor(connId, connDbType);
          const preview = executor.preview(commands);
          sections.push(`-- === ${connName} ===\n\n${preview.content}`);
        }
        setGeneratedSQL(sections.join("\n\n"));
      } catch (error) {
        logger.error(
          "[GlobalChangesDialog] Failed to generate preview:",
          error,
        );
        setGeneratedSQL("-- Error generating preview");
      }
      setSqlGenerated(true);
    };
    void generatePreview();
  }, [viewMode, sqlGenerated, ddlPreviewCommands, connections]);

  // Reset SQL cache when commands change
  useEffect(() => {
    setSqlGenerated(false);
  }, [ddlPreviewCommands, connections]);

  // Copy SQL to clipboard
  const handleCopySQL = useCallback(async () => {
    try {
      await writeClipboardText(generatedSQL);
      setCopiedSql(true);
      setTimeout(() => {
        setCopiedSql(false);
      }, 2000);
    } catch {
      toast.error("Failed to copy SQL");
    }
  }, [generatedSQL]);

  const ensureValidTableScope = useCallback(() => {
    if (isTableSpecific && !connectionId) {
      logger.error(
        "[GlobalChangesDialog] Invalid table-specific scope: missing connectionId",
      );
      toast.error(
        "Internal error: missing connection context for table-specific changes",
      );
      onOpenChange(false);
      return null;
    }
    return connectionId ?? null;
  }, [isTableSpecific, connectionId, onOpenChange]);

  const isConflictErrorMessage = useCallback(
    (errorMessage: string): boolean => {
      return (
        errorMessage.includes("modified by another user") ||
        errorMessage.includes("CONFLICT")
      );
    },
    [],
  );

  const handleCommitAll = async () => {
    setIsCommittingLocal(true);
    setConflictError(null);
    try {
      const scopedConnectionId = ensureValidTableScope();
      if (isTableSpecific && !scopedConnectionId) {
        return;
      }

      if (isTableSpecific && scopedConnectionId) {
        const tableKey = getTableKey({
          connectionId: scopedConnectionId,
          database: database,
          schema,
          table: table,
        });
        const result = await commitChanges(tableKey);

        await new Promise((resolve) => setTimeout(resolve, 100));

        const tableCommands = stagedCommands.get(tableKey) ?? [];
        const hasSchemaChanges = tableCommands.some(isSchemaChangingCommand);
        const { invalidateTable, invalidateSchema } =
          useDataInvalidationStore.getState();

        if (hasSchemaChanges) {
          invalidateSchema(scopedConnectionId, database, schema);
        } else {
          invalidateTable(scopedConnectionId, database, schema, table);
        }

        clearCommittedChanges(tableKey);

        toast.success("Changes committed", {
          description: `Successfully committed ${
            result.committed.length
          } change${result.committed.length === 1 ? "" : "s"} in ${
            result.durationMs
          }ms`,
        });

        onOpenChange(false);
        onCommitSuccess?.();
        return;
      }

      const successful: Array<{ tableKey: string; committedCount: number }> =
        [];
      const failed: Array<{ tableKey: string; error: string }> = [];

      for (const [tableKey] of connectionCommands) {
        try {
          const result = await commitChanges(tableKey);
          successful.push({
            tableKey,
            committedCount: result.committed.length,
          });
        } catch (error) {
          failed.push({
            tableKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (successful.length > 0) {
        const successfulCommands: CrudCommand[] = [];
        successful.forEach(({ tableKey }) => {
          const commands = stagedCommands.get(tableKey) ?? [];
          successfulCommands.push(...commands);
        });
        const hasSchemaChanges = successfulCommands.some(
          isSchemaChangingCommand,
        );
        const { invalidateTable, invalidateSchema } =
          useDataInvalidationStore.getState();

        if (hasSchemaChanges) {
          const schemas = new Set<string>();
          successful.forEach(({ tableKey }) => {
            const [connId, db, sch] = tableKey.split(":");
            if (connId && db && sch) {
              schemas.add(`${connId}:${db}:${sch}`);
            }
          });
          schemas.forEach((schemaKey) => {
            const [connId, db, sch] = schemaKey.split(":");
            if (connId && db && sch) {
              invalidateSchema(connId, db, sch);
            }
          });
        } else {
          successful.forEach(({ tableKey }) => {
            const [connId, db, sch, tbl] = tableKey.split(":");
            if (connId && db && tbl) {
              invalidateTable(connId, db, sch, tbl);
            }
          });
        }

        successful.forEach(({ tableKey }) => {
          clearCommittedChanges(tableKey);
        });
      }

      const totalCommitted = successful.reduce(
        (sum, item) => sum + item.committedCount,
        0,
      );

      if (failed.length > 0) {
        const conflictFailure = failed.find(({ error }) =>
          isConflictErrorMessage(error),
        );
        if (conflictFailure) {
          setConflictError(conflictFailure.error);
        }

        if (totalCommitted > 0) {
          toast.success("Partially committed changes", {
            description: `Committed ${totalCommitted} change${
              totalCommitted === 1 ? "" : "s"
            }.`,
          });
        }

        const failedTables = failed
          .map(({ tableKey }) => getDisplayTableName(tableKey))
          .join(", ");
        toast.error("Some changes failed to commit", {
          description: failedTables || failed[0]?.error || "Unknown error",
        });
        return;
      }

      toast.success("All changes committed", {
        description: `Successfully committed ${totalCommitted} change${
          totalCommitted === 1 ? "" : "s"
        } across all tables`,
      });
      onOpenChange(false);
      onCommitSuccess?.();
    } catch (error) {
      logger.error("❌ Commit failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      if (isConflictErrorMessage(errorMessage)) {
        setConflictError(errorMessage);
      } else {
        toast.error("Commit failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsCommittingLocal(false);
    }
  };

  // Force commit - strips oldValue from UPDATE commands to bypass conflict check
  const handleForceCommit = async () => {
    setIsCommittingLocal(true);
    setConflictError(null);

    try {
      const scopedConnectionId = ensureValidTableScope();
      if (isTableSpecific && !scopedConnectionId) {
        return;
      }

      // Get current staged commands and create NEW commands without oldValue
      const tableKey =
        isTableSpecific && scopedConnectionId
          ? getTableKey({
              connectionId: scopedConnectionId,
              database: database,
              schema,
              table: table,
            })
          : null;

      // Helper to strip oldValue from a command (creates new object)
      const stripOldValue = (cmd: CrudCommand): CrudCommand => {
        if (cmd.type !== "data.update") return cmd;

        const payload = cmd.payload as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { oldValue, ...payloadWithoutOldValue } = payload;

        return {
          ...cmd,
          payload: payloadWithoutOldValue,
        } as CrudCommand;
      };

      // Update staged commands in store with oldValue removed
      const {
        stageCommands,
        discardChanges: discardTableChanges,
        clearCommittedChanges: clearChanges,
      } = useCrudStore.getState();

      if (isTableSpecific) {
        if (!tableKey || !scopedConnectionId) {
          return;
        }

        const originalCommands = stagedCommands.get(tableKey) ?? [];
        const strippedCommands = originalCommands.map(stripOldValue);

        // Clear existing commands and re-stage without oldValue
        discardTableChanges(tableKey);
        stageCommands(strippedCommands);

        // Now commit
        const result = await commitChanges(tableKey);

        await new Promise((resolve) => setTimeout(resolve, 100));

        const { invalidateTable } = useDataInvalidationStore.getState();
        invalidateTable(scopedConnectionId, database, schema, table);

        // Clear committed changes from store
        clearChanges(tableKey);

        toast.success("Changes force-committed", {
          description: `Overwrote with your changes (${
            result.committed.length
          } change${result.committed.length === 1 ? "" : "s"})`,
        });
        onOpenChange(false);
        onCommitSuccess?.();
        return;
      }

      // For workspace-wide, strip and commit each table individually
      // to avoid data loss if a mid-sequence commit fails
      const successful: Array<{ tableKey: string; committedCount: number }> =
        [];
      const failed: Array<{ tableKey: string; error: string }> = [];

      for (const [tableKeyToCommit, commands] of connectionCommands) {
        try {
          // Strip oldValue and restage immediately before committing this table
          const strippedCommands = commands.map(stripOldValue);
          discardTableChanges(tableKeyToCommit);
          stageCommands(strippedCommands);

          const result = await commitChanges(tableKeyToCommit);
          successful.push({
            tableKey: tableKeyToCommit,
            committedCount: result.committed.length,
          });
        } catch (error) {
          failed.push({
            tableKey: tableKeyToCommit,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const totalCommitted = successful.reduce(
        (sum, item) => sum + item.committedCount,
        0,
      );

      const { invalidateTable } = useDataInvalidationStore.getState();
      successful.forEach(({ tableKey: successfulTableKey }) => {
        const [connId, db, sch, tbl] = successfulTableKey.split(":");
        if (connId && db && tbl) {
          invalidateTable(connId, db, sch, tbl);
        }
        clearChanges(successfulTableKey);
      });

      if (failed.length > 0) {
        if (totalCommitted > 0) {
          toast.success("Partially force-committed changes", {
            description: `Committed ${totalCommitted} change${
              totalCommitted === 1 ? "" : "s"
            }.`,
          });
        }

        const failedTables = failed
          .map(({ tableKey: failedTableKey }) =>
            getDisplayTableName(failedTableKey),
          )
          .join(", ");
        toast.error("Some force commits failed", {
          description: failedTables || failed[0]?.error || "Unknown error",
        });
        return;
      }

      toast.success("All changes force-committed", {
        description: `Overwrote with your changes (${totalCommitted} total)`,
      });
      onOpenChange(false);
      onCommitSuccess?.();
      return;
    } catch (error) {
      logger.error("❌ Force commit failed:", error);
      toast.error("Force commit failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCommittingLocal(false);
    }
  };

  // Refresh - discard changes and refresh table data
  const handleRefreshAndDiscard = () => {
    const scopedConnectionId = ensureValidTableScope();
    if (isTableSpecific && !scopedConnectionId) {
      return;
    }

    // Discard staged changes
    if (isTableSpecific && scopedConnectionId) {
      const tableKey = getTableKey({
        connectionId: scopedConnectionId,
        database: database,
        schema,
        table: table,
      });
      discardChanges(tableKey);
    } else if (connectionId) {
      connectionCommands.forEach(([tableKey]) => {
        discardChanges(tableKey);
      });
    } else {
      discardAll();
    }

    // Invalidate to trigger refetch
    const { invalidateTable } = useDataInvalidationStore.getState();
    if (isTableSpecific && scopedConnectionId) {
      invalidateTable(scopedConnectionId, database, schema, table);
    } else {
      connectionCommands.forEach(([tk]) => {
        const parts = tk.split(":");
        const [connId, db, sch, tbl] = parts;
        if (connId && db && tbl) {
          invalidateTable(connId, db, sch, tbl);
        }
      });
    }

    setConflictError(null);
    onOpenChange(false);
    toast.success("Changes discarded", {
      description: "Table refreshed with latest data from database",
    });
  };

  const handleDiscardAll = () => {
    const scopedConnectionId = ensureValidTableScope();
    if (isTableSpecific && !scopedConnectionId) {
      return;
    }

    if (isTableSpecific && scopedConnectionId) {
      const tableKey = getTableKey({
        connectionId: scopedConnectionId,
        database: database,
        schema,
        table: table,
      });
      discardChanges(tableKey);
      toast.success("Changes discarded");
    } else if (connectionId) {
      connectionCommands.forEach(([tableKey]) => {
        discardChanges(tableKey);
      });
      toast.success("All changes discarded");
    } else {
      discardAll();
      toast.success("All changes discarded");
    }
    onOpenChange(false);
  };

  const handleUndoRow = useCallback(
    (commands: CrudCommand[]) => {
      commands.forEach((cmd) => {
        unstageCommand(cmd.id);
      });

      const commandCount = commands.length;
      const commandType = commands[0]?.type.split(".")[1] || "change";
      toast.success(`${commandType} change undone`, {
        description: `Removed ${commandCount} ${
          commandCount === 1 ? "field" : "fields"
        }`,
      });
    },
    [unstageCommand],
  );

  // Don't render at all when truly empty (after ready is true and still no commands)
  if (connectionCommands.length === 0 && ready) {
    return null;
  }

  const showSidebar =
    !isTableSpecific && (tableSummaries.length > 1 || isWorkspaceWide);
  const isLoading =
    !ready || connectionCommands.length === 0 || isDerivingChanges;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col max-w-none! w-screen! h-screen! rounded-none! p-0 gap-0 overflow-hidden border-none z-50 bg-secondary"
        showCloseButton={false}
      >
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            setViewMode(value as "changes" | "ddl");
          }}
          className="flex flex-1 min-h-0 flex-col gap-0"
        >
          {/* Top Bar */}
          <div
            data-tauri-drag-region
            className="h-8 flex items-center gap-3 px-4 pl-20 bg-secondary shrink-0 pt-0.5"
          >
            <Button
              variant="ghost"
              className="px-2 gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              <IconChevronLeft className="size-4!" />
              <span className="text-sm">Back</span>
            </Button>
            <Separator orientation="vertical" className="h-4 mt-2" />
            <span className="text-sm font-medium">
              {isTableSpecific
                ? "Commit Changes"
                : isWorkspaceWide
                  ? "Review All Changes"
                  : "Review Changes"}
            </span>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {totalChanges} {totalChanges === 1 ? "change" : "changes"}
                {!isTableSpecific && tableSummaries.length > 0 && (
                  <>
                    {" "}
                    across {tableSummaries.length}{" "}
                    {tableSummaries.length === 1 ? "table" : "tables"}
                  </>
                )}
                {isWorkspaceWide && connectionGroups.length > 1 && (
                  <> in {connectionGroups.length} connections</>
                )}
              </span>
            )}
          </div>

          {/* Main Content Area */}
          <div className="flex flex-1 min-h-0">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Sidebar - table list (workspace-wide mode with multiple tables) */}
                {showSidebar && (
                  <div className="w-64 shrink-0 bg-secondary flex flex-col">
                    <div className="px-3 pt-3 pb-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">
                        {isWorkspaceWide ? "Connections" : "Tables"}
                      </p>
                    </div>
                    <div className="flex-1 overflow-y-auto px-1.5 pb-2">
                      {/* "All" option */}
                      <button
                        className={cn(
                          "w-full text-left px-2.5 py-2 rounded-lg text-sm mb-1 transition-all duration-150",
                          selectedTableKey === null &&
                            selectedConnectionId === null
                            ? "bg-background text-foreground ring-1 ring-border/40"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                        )}
                        onClick={() => {
                          setSelectedTableKey(null);
                          setSelectedConnectionId(null);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">All changes</span>
                          <span
                            className={cn(
                              "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full",
                              selectedTableKey === null &&
                                selectedConnectionId === null
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {totalChanges}
                          </span>
                        </div>
                      </button>

                      {isWorkspaceWide && connectionGroups.length > 0
                        ? connectionGroups.map((group) => {
                            const isExpanded = expandedConnections.has(
                              group.connectionId,
                            );
                            const isConnectionSelected =
                              selectedConnectionId === group.connectionId &&
                              selectedTableKey === null;

                            return (
                              <div key={group.connectionId} className="mt-0.5">
                                {/* Connection header */}
                                <div
                                  className={cn(
                                    "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-all duration-150 cursor-pointer group",
                                    isConnectionSelected
                                      ? "bg-background text-foreground ring-1 ring-border/40"
                                      : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                                  )}
                                  onClick={() => {
                                    setSelectedConnectionId(group.connectionId);
                                    setSelectedTableKey(null);
                                  }}
                                >
                                  {/* Expand/collapse chevron */}
                                  <button
                                    aria-label={
                                      isExpanded
                                        ? `Collapse ${group.connectionName}`
                                        : `Expand ${group.connectionName}`
                                    }
                                    aria-expanded={isExpanded}
                                    className="p-0.5 -ml-0.5 rounded hover:bg-muted/80 transition-colors shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedConnections((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(group.connectionId)) {
                                          next.delete(group.connectionId);
                                        } else {
                                          next.add(group.connectionId);
                                        }
                                        return next;
                                      });
                                    }}
                                  >
                                    {isExpanded ? (
                                      <IconChevronDown className="h-3 w-3 text-muted-foreground" />
                                    ) : (
                                      <IconChevronRight className="h-3 w-3 text-muted-foreground" />
                                    )}
                                  </button>
                                  {/* DB type logo */}
                                  <img
                                    src={getDatabaseLogo(group.dbType)}
                                    alt={group.dbType}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="font-medium truncate flex-1 min-w-0">
                                    {group.connectionName}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
                                      isConnectionSelected
                                        ? "bg-primary/10 text-primary"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {group.totalChanges}
                                  </span>
                                </div>

                                {/* Table list — collapsible */}
                                {isExpanded && (
                                  <div className="ml-3 mt-0.5 pl-2.5 border-l border-border/40">
                                    {group.tables.map((ts) => {
                                      const sidebarName = getSidebarTableName(
                                        ts.tableKey,
                                      );
                                      return (
                                        <Tooltip key={ts.tableKey}>
                                          <TooltipTrigger
                                            render={
                                              <button
                                                className={cn(
                                                  "w-full text-left px-2 py-1.5 rounded-md text-sm mb-px transition-all duration-150",
                                                  selectedTableKey ===
                                                    ts.tableKey
                                                    ? "bg-background text-foreground ring-1 ring-border/40"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                                                )}
                                                onClick={() => {
                                                  setSelectedConnectionId(
                                                    group.connectionId,
                                                  );
                                                  setSelectedTableKey(
                                                    ts.tableKey,
                                                  );
                                                }}
                                              />
                                            }
                                          >
                                            <div className="flex items-center gap-1.5 min-w-0">
                                              <IconTable className="h-3 w-3 shrink-0 opacity-40" />
                                              <span className="truncate text-xs font-medium">
                                                {sidebarName}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5 ml-[18px]">
                                              {ts.inserts > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                                                  +{ts.inserts}
                                                </span>
                                              )}
                                              {ts.updates > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                                                  ~{ts.updates}
                                                </span>
                                              )}
                                              {ts.deletes > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                                                  -{ts.deletes}
                                                </span>
                                              )}
                                              {ts.ddl > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                                                  {ts.ddl} DDL
                                                </span>
                                              )}
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent
                                            side="right"
                                            sideOffset={8}
                                          >
                                            {ts.displayName}
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        : tableSummaries.map((ts) => (
                            <Tooltip key={ts.tableKey}>
                              <TooltipTrigger
                                render={
                                  <button
                                    className={cn(
                                      "w-full text-left px-2.5 py-2 rounded-lg text-sm mb-0.5 transition-all duration-150",
                                      selectedTableKey === ts.tableKey
                                        ? "bg-background text-foreground ring-1 ring-border/40"
                                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                                    )}
                                    onClick={() => {
                                      setSelectedTableKey(ts.tableKey);
                                    }}
                                  />
                                }
                              >
                                <div className="flex items-center gap-1.5">
                                  <IconTable className="h-3.5 w-3.5 shrink-0 opacity-40" />
                                  <span className="truncate font-medium">
                                    {ts.displayName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 ml-5">
                                  {ts.inserts > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                                      +{ts.inserts}
                                    </span>
                                  )}
                                  {ts.updates > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                                      ~{ts.updates}
                                    </span>
                                  )}
                                  {ts.deletes > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                                      -{ts.deletes}
                                    </span>
                                  )}
                                  {ts.ddl > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                                      {ts.ddl} DDL
                                    </span>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={8}>
                                {ts.displayName}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                    </div>
                  </div>
                )}

                {/* Content Panel */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0 p-2 bg-transparent">
                  <div className="flex-1 flex flex-col overflow-hidden bg-background rounded-xl">
                    {/* Conflict Alert */}
                    {conflictError && (
                      <Alert
                        variant="destructive"
                        className="m-4 mb-0 border-destructive/50 bg-destructive/10"
                      >
                        <IconAlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm font-semibold">
                          Conflict Detected
                        </AlertTitle>
                        <AlertDescription>
                          <p className="mb-3">
                            The row was modified by another user or process
                            since you started editing. You can either override
                            with your changes or refresh to see the latest data.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="destructive"
                              onClick={handleForceCommit}
                              disabled={isCommitting}
                            >
                              {isCommitting ? (
                                <IconLoader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <IconShieldCheck className="mr-1 h-3 w-3" />
                              )}
                              Override with My Changes
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleRefreshAndDiscard}
                              disabled={isCommitting}
                            >
                              <IconRefresh className="mr-1 h-3 w-3" />
                              Discard & Refresh
                            </Button>
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Content area — plain conditional instead of TabsContent to keep flex chain intact */}
                    {viewMode === "changes" ? (
                      <div className="flex-1 flex flex-col min-h-0">
                        {filteredGroupedByRow.length === 0 ? (
                          <div className="text-sm text-muted-foreground text-center py-8">
                            No changes to display
                          </div>
                        ) : (
                          <VirtualizedChangesList
                            groupedByRow={filteredGroupedByRow}
                            onUndo={handleUndoRow}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4 pt-2">
                        <CodeEditor
                          value={generatedSQL || "-- No preview generated"}
                          readOnly={true}
                          language={ddlEditorLanguage}
                          dialect={
                            !isWorkspaceWide
                              ? dbTypeToDialect[dbType]
                              : undefined
                          }
                          lineNumbers={true}
                          height="100%"
                        />
                      </div>
                    )}

                    {/* Validation Error Alert */}
                    {!validationStatus.canCommitAll && (
                      <Alert variant="destructive" className="mx-4 mb-2">
                        <IconAlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          Cannot commit: validation errors
                        </AlertTitle>
                        <AlertDescription>
                          {validationStatus.totalErrors} validation{" "}
                          {validationStatus.totalErrors === 1
                            ? "error"
                            : "errors"}{" "}
                          in {Object.keys(validationStatus.tableErrors).length}{" "}
                          {Object.keys(validationStatus.tableErrors).length ===
                          1
                            ? "table"
                            : "tables"}
                          :{" "}
                          {Object.entries(validationStatus.tableErrors)
                            .map(([tbl, count]) => `${tbl} (${count})`)
                            .join(", ")}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Footer Actions */}
                    <div className="flex items-center gap-2 px-4 py-3 border-t border-border/50 shrink-0">
                      {/* View Mode Tabs — left side of footer */}
                      <TabsList>
                        <TabsTrigger value="changes" className="gap-1.5">
                          <IconList className="h-3 w-3" />
                          Changes
                        </TabsTrigger>
                        <TabsTrigger value="ddl" className="gap-1.5">
                          <IconCode className="h-3 w-3" />
                          DDL
                        </TabsTrigger>
                      </TabsList>
                      {viewMode === "ddl" && (
                        <Button
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={handleCopySQL}
                        >
                          {copiedSql ? (
                            <IconCheck className="h-4 w-4 text-green-500" />
                          ) : (
                            <IconCopy className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {/* Spacer */}
                      <div className="flex-1" />
                      {/* Action buttons — right side */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            onOpenChange(false);
                          }}
                          disabled={isCommitting}
                        >
                          Close
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleDiscardAll}
                          disabled={isCommitting}
                        >
                          <IconX className="h-3.5 w-3.5 mr-1.5" />
                          {isTableSpecific ? "Discard" : "Discard All"}
                        </Button>
                        <Button
                          onClick={handleCommitAll}
                          disabled={
                            isCommitting || !validationStatus.canCommitAll
                          }
                          title={
                            !validationStatus.canCommitAll
                              ? `Fix ${validationStatus.totalErrors} validation error${
                                  validationStatus.totalErrors === 1 ? "" : "s"
                                } before committing`
                              : undefined
                          }
                        >
                          {isCommitting ? (
                            <>
                              <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              Committing...
                            </>
                          ) : (
                            <>
                              <IconCircleCheckFilled className="h-3.5 w-3.5 mr-1.5" />
                              Commit {totalChanges}{" "}
                              {totalChanges === 1 ? "Change" : "Changes"}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Virtualized Changes List ----------

interface VirtualizedChangesListProps {
  groupedByRow: Array<{
    rowKey: string;
    tableName: string;
    commands: CrudCommand[];
  }>;
  onUndo: (commands: CrudCommand[]) => void;
}

function VirtualizedChangesList({
  groupedByRow,
  onUndo,
}: VirtualizedChangesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const useLightweightDiff = groupedByRow.length > 150;

  // TanStack Virtual exposes mutable callbacks that React Compiler currently flags.

  const virtualizer = useVirtualizer({
    count: groupedByRow.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (useLightweightDiff ? 156 : 220),
    overscan: 6,
    getItemKey: (index) => {
      const row = groupedByRow[index];
      return row ? `${row.tableName}:${row.rowKey}:${index}` : `row-${index}`;
    },
  });

  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [groupedByRow, virtualizer]);

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto p-4">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = groupedByRow[virtualItem.index];
          if (!row) return null;

          return (
            <div
              key={`${row.tableName}:${row.rowKey}:${virtualItem.index}`}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
                paddingBottom: "8px",
              }}
            >
              <MemoizedRowChangesCard
                row={row}
                index={virtualItem.index}
                onUndo={onUndo}
                useLightweightDiff={useLightweightDiff}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Row Changes Card ----------

interface RowChangesCardProps {
  row: {
    rowKey: string;
    tableName: string;
    commands: CrudCommand[];
  };
  index: number;
  onUndo: (commands: CrudCommand[]) => void;
  useLightweightDiff: boolean;
}

function RowChangesCardInner({
  row,
  index,
  onUndo,
  useLightweightDiff,
}: RowChangesCardProps) {
  const { resolvedTheme } = useTheme();

  // Determine the operation type (insert, update, delete, DDL)
  const hasInsert = row.commands.some((cmd) => cmd.type === "data.insert");
  const hasDelete = row.commands.some((cmd) => cmd.type === "data.delete");
  const hasUpdate = row.commands.some((cmd) => cmd.type === "data.update");
  const hasDDL = row.commands.some(
    (cmd) =>
      cmd.type.startsWith("column.") ||
      cmd.type.startsWith("index.") ||
      cmd.type.startsWith("trigger.") ||
      cmd.type.startsWith("fk.") ||
      cmd.type.startsWith("table.") ||
      cmd.type.startsWith("view.") ||
      cmd.type.startsWith("constraint.") ||
      cmd.type.startsWith("sequence.") ||
      cmd.type.startsWith("document."),
  );

  // Get primary key info
  let pkInfo = "";
  if (hasUpdate || hasDelete) {
    const cmd = row.commands.find(
      (c) => c.type === "data.update" || c.type === "data.delete",
    );
    if (cmd) {
      const payload = cmd.payload as { primaryKeys?: Record<string, unknown> };
      if (payload.primaryKeys) {
        pkInfo = Object.entries(payload.primaryKeys)
          .map(([key, value]) => `${key}=${formatValue(value)}`)
          .join(", ");
      }
    }
  }

  // Build old and new row representations for diff
  // Memoize diff computation — expensive for large payloads and many cards
  const buildRowDiff = useCallback(() => {
    if (hasDDL) {
      const formatDdlValue = (value: unknown): string => formatValue(value);

      // Handle DDL commands
      const ddlLines: string[] = [];
      row.commands.forEach((cmd) => {
        const desc = cmd.metadata.description ?? cmd.type;
        ddlLines.push(desc);

        // Show payload details
        const payload = cmd.payload as Record<string, unknown>;
        if (cmd.type === "table.create") {
          // table.create - show table definition
          if (payload.tableName) {
            ddlLines.push(`  Table: ${formatDdlValue(payload.tableName)}`);
          }
          if (Array.isArray(payload.columns)) {
            ddlLines.push(`  Columns:`);
            payload.columns.forEach(
              (col: {
                name?: string;
                dataType?: string;
                nullable?: boolean;
                defaultValue?: unknown;
                isPrimaryKey?: boolean;
                checkExpression?: string;
                comment?: string;
              }) => {
                let colDef = `    - ${col.name}: ${col.dataType}`;
                if (col.nullable === false) colDef += " NOT NULL";
                if (col.defaultValue !== undefined && col.defaultValue !== null)
                  colDef += ` DEFAULT ${formatDdlValue(col.defaultValue)}`;
                if (col.isPrimaryKey) colDef += " (PK)";
                if (col.checkExpression)
                  colDef += ` CHECK (${col.checkExpression})`;
                if (col.comment) colDef += ` -- ${col.comment}`;
                ddlLines.push(colDef);
              },
            );
          }
          if (
            Array.isArray(payload.primaryKey) &&
            payload.primaryKey.length > 0
          ) {
            ddlLines.push(
              `  Primary Key: (${(payload.primaryKey as string[]).join(", ")})`,
            );
          }
        } else if (cmd.type === "table.rename") {
          // table.rename - show old → new
          const oldName = cmd.target.table;
          if (oldName && payload.newName) {
            ddlLines.push(`  ${oldName} → ${formatDdlValue(payload.newName)}`);
          }
        } else if (cmd.type === "table.drop") {
          // table.drop - show table name
          if (payload.tableName) {
            ddlLines.push(`  Table: ${formatDdlValue(payload.tableName)}`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "table.truncate") {
          // table.truncate - show table name and options
          if (payload.tableName) {
            ddlLines.push(`  Table: ${formatDdlValue(payload.tableName)}`);
          }
          if (payload.restartIdentity) {
            ddlLines.push(`  Restart Identity: true`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "table.duplicate") {
          // table.duplicate - show source → target and options
          if (payload.sourceTableName && payload.newTableName) {
            ddlLines.push(
              `  ${formatDdlValue(payload.sourceTableName)} → ${formatDdlValue(payload.newTableName)}`,
            );
          }
          const options: string[] = [];
          if (payload.includeData) options.push("data");
          if (payload.includeIndexes) options.push("indexes");
          if (payload.includeConstraints) options.push("constraints");
          if (payload.includeTriggers) options.push("triggers");
          if (options.length > 0) {
            ddlLines.push(`  Include: ${options.join(", ")}`);
          }
        } else if (cmd.type === "view.create") {
          // view.create - show view definition
          if (payload.definition) {
            const viewDef = payload.definition as {
              name?: string;
              definition?: string;
              isMaterialized?: boolean;
            };
            if (viewDef.name) {
              ddlLines.push(
                `  View: ${viewDef.name}${viewDef.isMaterialized ? " (MATERIALIZED)" : ""}`,
              );
            }
            if (viewDef.definition) {
              const defPreview =
                viewDef.definition.length > 100
                  ? viewDef.definition.slice(0, 100) + "..."
                  : viewDef.definition;
              ddlLines.push(`  Definition: ${defPreview}`);
            }
          }
        } else if (cmd.type === "view.drop") {
          // view.drop - show view name
          if (payload.viewName) {
            ddlLines.push(
              `  View: ${formatDdlValue(payload.viewName)}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`,
            );
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "view.replace") {
          // view.replace - show view name and new definition
          if (payload.viewName) {
            ddlLines.push(
              `  View: ${formatDdlValue(payload.viewName)}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`,
            );
          }
          if (payload.definition !== undefined && payload.definition !== null) {
            const definitionText =
              typeof payload.definition === "string"
                ? payload.definition
                : formatDdlValue(payload.definition);
            const defPreview =
              definitionText.length > 100
                ? definitionText.slice(0, 100) + "..."
                : definitionText;
            ddlLines.push(`  New Definition: ${defPreview}`);
          }
        } else if (cmd.type === "view.rename") {
          // view.rename - show old → new
          if (payload.viewName && payload.newName) {
            ddlLines.push(
              `  ${formatDdlValue(payload.viewName)} → ${formatDdlValue(payload.newName)}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`,
            );
          }
        } else if (cmd.type.startsWith("constraint.")) {
          // constraint operations
          if (
            cmd.type === "constraint.addPrimaryKey" ||
            cmd.type === "constraint.addUnique" ||
            cmd.type === "constraint.addCheck"
          ) {
            if (payload.definition) {
              const constraintDef = payload.definition as {
                name?: string;
                type?: string;
                columns?: string[];
                expression?: string;
              };
              if (constraintDef.name) {
                ddlLines.push(
                  `  Constraint: ${constraintDef.name} (${constraintDef.type?.toUpperCase()})`,
                );
              }
              if (constraintDef.columns && constraintDef.columns.length > 0) {
                ddlLines.push(`  Columns: ${constraintDef.columns.join(", ")}`);
              }
              if (constraintDef.expression) {
                ddlLines.push(`  Expression: ${constraintDef.expression}`);
              }
            }
          } else if (cmd.type === "constraint.rename") {
            if (payload.constraintName && payload.newName) {
              ddlLines.push(
                `  ${formatDdlValue(payload.constraintName)} → ${formatDdlValue(payload.newName)}`,
              );
            }
          } else {
            // drop operations
            if (payload.constraintName) {
              ddlLines.push(
                `  Constraint: ${formatDdlValue(payload.constraintName)}`,
              );
            }
            if (payload.cascade) {
              ddlLines.push(`  Cascade: true`);
            }
          }
        } else if (cmd.type === "sequence.create") {
          // sequence.create - show sequence definition
          if (payload.definition) {
            const seqDef = payload.definition as {
              name?: string;
              increment?: number;
              minValue?: number;
              maxValue?: number;
              startValue?: number;
              cycle?: boolean;
            };
            if (seqDef.name) {
              ddlLines.push(`  Sequence: ${seqDef.name}`);
            }
            if (seqDef.increment !== undefined) {
              ddlLines.push(`  Increment: ${seqDef.increment}`);
            }
            if (seqDef.startValue !== undefined) {
              ddlLines.push(`  Start: ${seqDef.startValue}`);
            }
            if (seqDef.minValue !== undefined) {
              ddlLines.push(`  Min: ${seqDef.minValue}`);
            }
            if (seqDef.maxValue !== undefined) {
              ddlLines.push(`  Max: ${seqDef.maxValue}`);
            }
            if (seqDef.cycle) {
              ddlLines.push(`  Cycle: true`);
            }
          }
        } else if (cmd.type === "sequence.alter") {
          // sequence.alter - show changes
          if (payload.sequenceName) {
            ddlLines.push(
              `  Sequence: ${formatDdlValue(payload.sequenceName)}`,
            );
          }
          if (payload.changes) {
            const changes = payload.changes as Record<string, unknown>;
            Object.entries(changes).forEach(([key, value]) => {
              ddlLines.push(`  ${key}: ${formatDdlValue(value)}`);
            });
          }
        } else if (cmd.type === "sequence.drop") {
          // sequence.drop - show sequence name
          if (payload.sequenceName) {
            ddlLines.push(
              `  Sequence: ${formatDdlValue(payload.sequenceName)}`,
            );
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "sequence.rename") {
          // sequence.rename - show old → new
          if (payload.sequenceName && payload.newName) {
            ddlLines.push(
              `  ${formatDdlValue(payload.sequenceName)} → ${formatDdlValue(payload.newName)}`,
            );
          }
        } else if (payload.column) {
          // column.add - show full column definition
          ddlLines.push(`  Column: ${JSON.stringify(payload.column, null, 2)}`);
        } else if (payload.definition) {
          // index/trigger - show definition
          ddlLines.push(
            `  Definition: ${JSON.stringify(payload.definition, null, 2)}`,
          );
        } else if (payload.columnName && payload.newDefinition) {
          // column.modify - show what changed
          const name = payload.columnName;
          ddlLines.push(`  Column: ${formatDdlValue(name)}`);
          const newDef = payload.newDefinition as {
            dataType?: string;
            nullable?: boolean;
            defaultValue?: string | null;
            comment?: string;
          };
          if (newDef.dataType !== undefined) {
            ddlLines.push(`  Type: ${newDef.dataType}`);
          }
          if (newDef.nullable !== undefined) {
            ddlLines.push(`  Nullable: ${newDef.nullable ? "YES" : "NO"}`);
          }
          if (newDef.defaultValue !== undefined) {
            ddlLines.push(`  Default: ${newDef.defaultValue ?? "NULL"}`);
          }
          if (newDef.comment !== undefined) {
            ddlLines.push(`  Comment: ${newDef.comment}`);
          }
        } else if (payload.newName && payload.columnName) {
          // column.rename - show old → new
          ddlLines.push(
            `  ${formatDdlValue(payload.columnName)} → ${formatDdlValue(payload.newName)}`,
          );
        } else if (payload.newName && payload.indexName) {
          // index.rename - show old → new
          ddlLines.push(
            `  ${formatDdlValue(payload.indexName)} → ${formatDdlValue(payload.newName)}`,
          );
        } else if (payload.newName && payload.triggerName) {
          // trigger.rename - show old → new
          ddlLines.push(
            `  ${formatDdlValue(payload.triggerName)} → ${formatDdlValue(payload.newName)}`,
          );
        } else if (
          payload.columnName ||
          payload.indexName ||
          payload.triggerName ||
          payload.constraintName
        ) {
          // Other DDL operations (drop, etc.)
          const name =
            payload.columnName ||
            payload.indexName ||
            payload.triggerName ||
            payload.constraintName;
          ddlLines.push(`  Name: ${formatDdlValue(name)}`);
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        }
      });

      return { old: "", new: ddlLines.join("\n") };
    }

    if (hasInsert) {
      const insertCmd = row.commands.find((cmd) => cmd.type === "data.insert");
      if (!insertCmd) return { old: "", new: "" };

      const payload = insertCmd.payload as {
        values?: Record<string, unknown>;
      };
      const values = payload.values || {};

      const entries = Object.entries(values);
      if (entries.length === 0) {
        return { old: "", new: "(new empty document)" };
      }

      const newRow = entries
        .map(([key, value]) => {
          const formatted = formatValue(value);
          // For long INSERT values, truncate in the middle
          return `${key}: ${
            formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted
          }`;
        })
        .join("\n");

      return { old: "", new: newRow };
    }

    if (hasDelete) {
      const deleteCmd = row.commands.find((cmd) => cmd.type === "data.delete");
      if (!deleteCmd) return { old: "", new: "" };

      const payload = deleteCmd.payload as {
        primaryKeys?: Record<string, unknown>;
      };
      const pks = payload.primaryKeys || {};

      const oldRow = Object.entries(pks)
        .map(([key, value]) => {
          const formatted = formatValue(value);
          // For long DELETE values, truncate in the middle
          return `${key}: ${
            formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted
          }`;
        })
        .join("\n");

      return { old: oldRow, new: "" };
    }

    if (hasUpdate) {
      const updateCmds = row.commands.filter(
        (cmd) => cmd.type === "data.update",
      );

      // Build a map of column -> [oldValue, newValue]
      const changes = new Map<string, { old: unknown; new: unknown }>();

      updateCmds.forEach((cmd) => {
        const payload = cmd.payload as {
          column?: string;
          oldValue: unknown;
          newValue: unknown;
        };
        if (payload.column) {
          changes.set(payload.column, {
            old: payload.oldValue,
            new: payload.newValue,
          });
        }
      });

      const oldRow: string[] = [];
      const newRow: string[] = [];

      changes.forEach((values, column) => {
        // Use smart truncation for long values
        const { old, new: newVal } = formatValueWithSmartTruncation(
          values.old,
          values.new,
        );
        oldRow.push(`${column}: ${old}`);
        newRow.push(`${column}: ${newVal}`);
      });

      return { old: oldRow.join("\n"), new: newRow.join("\n") };
    }

    return { old: "", new: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the command list identity
  }, [row.commands]);

  const { old, new: newVal } = useMemo(() => buildRowDiff(), [buildRowDiff]);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <span className="text-xs text-muted-foreground font-mono">
          #{index + 1}
        </span>
        <span className="text-xs text-muted-foreground">{row.tableName}</span>
        {hasInsert && (
          <>
            <IconPlus className="h-3.5 w-3.5 text-green-500 ml-2" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              Insert
            </span>
          </>
        )}
        {hasDelete && (
          <>
            <IconTrash className="h-3.5 w-3.5 text-red-500 ml-2 select-text" />
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              Delete
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-1">
                {pkInfo}
              </span>
            )}
          </>
        )}
        {hasUpdate && (
          <>
            <IconPencil className="h-3.5 w-3.5 text-blue-500 ml-2" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Update
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-1">
                {pkInfo}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              ({row.commands.length}{" "}
              {row.commands.length === 1 ? "field" : "fields"})
            </span>
          </>
        )}
        {hasDDL && (
          <>
            <IconPencil className="h-3.5 w-3.5 text-purple-500 ml-2" />
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
              DDL
            </span>
            <span className="text-xs text-muted-foreground">
              ({row.commands.length}{" "}
              {row.commands.length === 1 ? "change" : "changes"})
            </span>
          </>
        )}

        {/* Undo Button */}
        <Button
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onUndo(row.commands);
          }}
        >
          <IconArrowBackUp className="h-3 w-3 mr-1" />
          Undo
        </Button>
      </div>

      {/* Diff Viewer */}
      <div className="text-xs [&_.diff-viewer]:!text-xs [&_.diff-viewer]:!font-mono">
        {!old && !newVal ? (
          <div className="p-3 text-muted-foreground italic">
            Unable to display diff for {row.commands.length} command(s):
            {row.commands.map((c, i) => (
              <span key={i} className="ml-2 text-xs font-mono">
                {c.type}
              </span>
            ))}
          </div>
        ) : useLightweightDiff ? (
          <SimpleDiffView oldValue={old} newValue={newVal} />
        ) : (
          <LegacyDiffView
            oldValue={old}
            newValue={newVal}
            useDarkTheme={resolvedTheme === "dark"}
          />
        )}
      </div>
    </div>
  );
}

const MemoizedRowChangesCard = memo(RowChangesCardInner, (prev, next) => {
  // Re-render only when row identity or commands change
  return (
    prev.row.rowKey === next.row.rowKey &&
    prev.row.commands === next.row.commands &&
    prev.index === next.index &&
    prev.onUndo === next.onUndo &&
    prev.useLightweightDiff === next.useLightweightDiff
  );
});

function LegacyDiffView({
  oldValue,
  newValue,
  useDarkTheme,
}: {
  oldValue: string;
  newValue: string;
  useDarkTheme: boolean;
}) {
  return (
    <ReactDiffViewer
      oldValue={oldValue}
      newValue={newValue}
      splitView={true}
      hideLineNumbers={true}
      showDiffOnly={false}
      compareMethod={DiffMethod.WORDS}
      useDarkTheme={useDarkTheme}
      styles={{
        variables: {
          light: {
            diffViewerBackground: "#FAF8F5",
            addedBackground: "#16A34A1A",
            addedColor: "#27231E",
            removedBackground: "#DC26261A",
            removedColor: "#27231E",
            wordAddedBackground: "#16A34A33",
            wordRemovedBackground: "#DC262633",
            addedGutterBackground: "#16A34A14",
            removedGutterBackground: "#DC262614",
            gutterBackground: "#FAF8F5",
            gutterBackgroundDark: "#F5F3F0",
            highlightBackground: "#D4A52B1A",
            highlightGutterBackground: "#D4A52B14",
            emptyLineBackground: "#FAF8F5",
            codeFoldBackground: "#F5F3F0",
            codeFoldGutterBackground: "#F5F3F0",
          },
          dark: {
            diffViewerBackground: "#110F0C",
            addedBackground: "#22C55E1A",
            addedColor: "#EBE7E2",
            removedBackground: "#EF44441A",
            removedColor: "#EBE7E2",
            wordAddedBackground: "#22C55E33",
            wordRemovedBackground: "#EF444433",
            addedGutterBackground: "#22C55E14",
            removedGutterBackground: "#EF444414",
            gutterBackground: "#110F0C",
            gutterBackgroundDark: "#0D0B09",
            highlightBackground: "#D4A52B1A",
            highlightGutterBackground: "#D4A52B14",
            emptyLineBackground: "#110F0C",
            codeFoldBackground: "#1A1714",
            codeFoldGutterBackground: "#1A1714",
          },
        },
      }}
    />
  );
}

function SimpleDiffView({
  oldValue,
  newValue,
}: {
  oldValue: string;
  newValue: string;
}) {
  const oldDisplay = oldValue || " ";
  const newDisplay = newValue || " ";

  return (
    <div className="grid grid-cols-2 divide-x divide-border">
      <pre className="m-0 max-h-48 overflow-x-auto overflow-y-hidden bg-destructive/5 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {oldDisplay}
      </pre>
      <pre className="m-0 max-h-48 overflow-x-auto overflow-y-hidden bg-emerald-500/5 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {newDisplay}
      </pre>
    </div>
  );
}

/**
 * Format a value for display in the diff viewer.
 * For short values, show the full value.
 * For long values, show the full value (truncation happens at the diff level).
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value; // No quotes for cleaner display
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized) {
      return serialized;
    }
  } catch {
    // Fall through to Object.prototype fallback below.
  }
  return Object.prototype.toString.call(value);
}

/**
 * Smart truncation for long unchanged portions of text.
 * Shows context around changes like GitHub's diff view.
 */
function formatValueWithSmartTruncation(
  oldValue: unknown,
  newValue: unknown,
): { old: string; new: string } {
  const oldStr = formatValue(oldValue);
  const newStr = formatValue(newValue);

  // For short values, return as-is
  const MAX_LENGTH = 100;
  if (oldStr.length <= MAX_LENGTH && newStr.length <= MAX_LENGTH) {
    return { old: oldStr, new: newStr };
  }

  // For very different values (insert/delete), show with ellipsis
  if (oldStr === "NULL" || newStr === "NULL") {
    return {
      old:
        oldStr.length > MAX_LENGTH
          ? truncateMiddle(oldStr, MAX_LENGTH)
          : oldStr,
      new:
        newStr.length > MAX_LENGTH
          ? truncateMiddle(newStr, MAX_LENGTH)
          : newStr,
    };
  }

  // Find common prefix and suffix
  const { prefix, suffix, oldMiddle, newMiddle } = findDiff(oldStr, newStr);

  const CONTEXT_LENGTH = 30;
  const prefixContext =
    prefix.length > CONTEXT_LENGTH
      ? "..." + prefix.slice(-CONTEXT_LENGTH)
      : prefix;
  const suffixContext =
    suffix.length > CONTEXT_LENGTH
      ? suffix.slice(0, CONTEXT_LENGTH) + "..."
      : suffix;

  // If the middle parts are still too long, truncate them
  const oldMiddleTruncated =
    oldMiddle.length > MAX_LENGTH
      ? truncateMiddle(oldMiddle, MAX_LENGTH)
      : oldMiddle;
  const newMiddleTruncated =
    newMiddle.length > MAX_LENGTH
      ? truncateMiddle(newMiddle, MAX_LENGTH)
      : newMiddle;

  return {
    old: prefixContext + oldMiddleTruncated + suffixContext,
    new: prefixContext + newMiddleTruncated + suffixContext,
  };
}

/**
 * Find the common prefix, suffix, and differing middle parts of two strings.
 */
function findDiff(
  str1: string,
  str2: string,
): {
  prefix: string;
  suffix: string;
  oldMiddle: string;
  newMiddle: string;
} {
  let prefixEnd = 0;
  const minLen = Math.min(str1.length, str2.length);

  // Find common prefix
  while (prefixEnd < minLen && str1[prefixEnd] === str2[prefixEnd]) {
    prefixEnd++;
  }

  // Find common suffix
  let suffixStart1 = str1.length;
  let suffixStart2 = str2.length;
  while (
    suffixStart1 > prefixEnd &&
    suffixStart2 > prefixEnd &&
    str1[suffixStart1 - 1] === str2[suffixStart2 - 1]
  ) {
    suffixStart1--;
    suffixStart2--;
  }

  return {
    prefix: str1.slice(0, prefixEnd),
    suffix: str1.slice(suffixStart1),
    oldMiddle: str1.slice(prefixEnd, suffixStart1),
    newMiddle: str2.slice(prefixEnd, suffixStart2),
  };
}

/**
 * Truncate a string in the middle, keeping start and end.
 */
function truncateMiddle(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  const halfLength = Math.floor(maxLength / 2) - 3;
  return str.slice(0, halfLength) + " ... " + str.slice(-halfLength);
}
