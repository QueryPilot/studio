/**
 * SqlDataGrid - SQL table browser with FK-specific features
 *
 * This is a thin wrapper around BaseDataGrid that provides:
 * - Data fetching via useTableDataQuery
 * - Command factory for SQL-specific CRUD commands
 * - FK embedded value display (passes embeddedValue to buildGridCellV2)
 *
 * All CRUD operations, optimistic updates, and general grid features
 * are handled by BaseDataGrid.
 */

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import type { Item, GridCell } from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconTable,
  IconListTree,
  IconBraces,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand, JsonValue } from "@/types/crud";
import type { InspectorTab } from "../components/inspector";
import { BaseDataGrid } from "../base/BaseDataGrid";
import { DocumentTreeView } from "../components/DocumentTreeView";
import { DocumentJsonView } from "../components/DocumentJsonView";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import type {
  GridColumnV2,
  GridRowModel,
  GridEditCommitEvent,
  GridCellContentContext,
  CrudCommandFactory,
} from "../types";
import { useTableDataQuery } from "@/hooks/useTableDataQuery";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { useReferencedTableColumns } from "@/hooks/useReferencedTableColumns";
import { buildGridCellV2 } from "../utils/cellFactory";
import { computeBaseWidth } from "./columnUtils";
import { databaseService } from "@/services/databaseService";
import { DataGridSkeleton } from "../components/DataGridSkeleton";
import { QuickFilter, type QuickFilterRef } from "../components/QuickFilter";
import { useQuickFilter } from "../hooks/useQuickFilter";
import { DbType, type GridCellValue } from "@/types";
import type { FilterColumnInfo } from "@/utils/filterParser";
import { useEmbeddedFKPreferencesStore } from "../stores/embeddedFKPreferencesStore";
import type { EmbeddedFKConfig } from "@/adapters/types";
import { getAdapterForConnection } from "@/adapters";
import {
  createInsertCommand,
  createUpdateCommand,
  createDeleteCommand,
  createCrudTarget,
} from "../utils/crudHelpers";
import { canProceedBestEffort } from "../utils/bestEffortMatcher";
import { chooseDeterministicIdentityColumns } from "../utils/rowIdentity";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";
import { useAcpStore, DEFAULT_QUICK_FILTER_MODEL } from "@/stores/acpStore";
import { AcpService } from "@/services/acpService";
import type { SortConfig } from "@/types/filter";
import type { SortColumn } from "../types";
import { Button } from "@/components/ui/button";

// Stable empty array to prevent infinite re-renders when sortColumns is undefined
const EMPTY_SORT_COLUMNS: SortColumn[] = [];
const EMPTY_ROW_IDENTIFIER_COLUMNS: string[] = [];

const areStringArraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export interface SqlDataGridProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
  dbType: DbType;
  readOnly?: boolean;
  /** Entity kind: Table, View, or MaterializedView */
  kind?: "Table" | "View" | "MaterializedView";
  onRefresh?: () => void;
  /** CSS class name for styling */
  className?: string;
  /** Callback for toolbar actions (legacy, not currently used) */
  onActionsChange?: (actions: React.ReactNode) => void;
  /** Initial WHERE clause filter (e.g., from FK reference navigation) */
  initialFilter?: string;
  /** Panel ID for FK reference navigation */
  panelId?: string;
  /** Whether this grid's panel is focused (for auto-focus) */
  focused?: boolean;
  /** Override grid ID used for sort preferences (for per-tab sort isolation) */
  sortGridId?: string;
}

export const SqlDataGrid = memo(function SqlDataGrid(props: SqlDataGridProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    dbType,
    readOnly = false,
    kind = "Table",
    className,
    focused = true,
  } = props;

  const gridId = `${connectionId}:${database}:${schema}:${table}`;
  const sortGridId = props.sortGridId ?? gridId;
  const tableName = table;

  // Ref for QuickFilter - passed to BaseDataGrid for Cmd+F handling
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const persistedInspector = useGridPreferencesStore(
    (s) => s.preferences[gridId]?.inspector,
  );
  const [showInspector, setShowInspector] = useState(
    () => persistedInspector?.open ?? false,
  );
  const [showIdentifierSelector, setShowIdentifierSelector] = useState(false);

  const persistedRowIdentifierColumns = useGridPreferencesStore(
    (state) =>
      state.preferences[gridId]?.rowIdentifierColumns ??
      EMPTY_ROW_IDENTIFIER_COLUMNS,
  );

  // Determine entity type and read-only status based on kind
  const entityType: "table" | "view" | "materialized_view" =
    kind === "MaterializedView"
      ? "materialized_view"
      : kind === "View"
        ? "view"
        : "table";

  const isViewOrMatView = kind === "View" || kind === "MaterializedView";
  const isReadOnly = readOnly || isViewOrMatView;
  const viewReadOnlyReason =
    kind === "View"
      ? "Read-only: View"
      : kind === "MaterializedView"
        ? "Read-only: Materialized View"
        : undefined;

  // --- Table Structure (needed for FK metadata before data query) ---
  const { structure: tableStructure } = useTableFullStructure({
    connectionId,
    database: database ?? "",
    schema: schema ?? "",
    table,
    options: {
      includeConstraints: true, // Required for FK data (FKs are extracted from constraints)
      includeForeignKeys: true, // Required for FK preview and embed features
      includeIndexes: true, // Required for deterministic identity fallback (UNIQUE indexes)
    },
  });

  // --- Embedded FK Configuration (needed before data query) ---
  // Build storage key for embedded FK preferences: {connectionId}:{schema}.{table}
  // Must match the key format used in FKEmbedSubmenu
  const embeddedFKKey = `${connectionId}:${schema ?? "public"}.${table}`;
  const embeddedFKPrefs = useEmbeddedFKPreferencesStore(
    (s) => s.preferences[embeddedFKKey],
  );

  const embeddedFKs = useMemo<EmbeddedFKConfig[]>(() => {
    if (!embeddedFKPrefs?.embeddedColumns || !tableStructure?.foreignKeys)
      return [];

    const configs: EmbeddedFKConfig[] = [];
    const seen = new Set<string>();
    for (const fk of tableStructure.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const colName = fk.columns[i];
        const refCol = fk.foreignColumns[i];
        if (!colName || !refCol) continue;
        // Skip duplicate FK columns (introspection may return the same FK twice)
        if (seen.has(colName)) continue;

        const refDisplayColumns = embeddedFKPrefs.embeddedColumns[colName];
        if (refDisplayColumns && refDisplayColumns.length > 0) {
          seen.add(colName);
          configs.push({
            fkColumn: colName,
            refSchema: fk.foreignSchema ?? "public",
            refTable: fk.foreignTable,
            refPkColumn: refCol,
            refDisplayColumns,
          });
        }
      }
    }
    return configs;
  }, [embeddedFKPrefs, tableStructure?.foreignKeys]);

  // Defer embedded FK changes to prevent lag during menu interaction
  const deferredEmbeddedFKs = useDeferredValue(embeddedFKs);

  // --- Filter Configuration ---
  // Build filter columns from tableStructure (available before query)
  const filterColumns = useMemo<FilterColumnInfo[]>(() => {
    if (!tableStructure?.columns) return [];

    // Build FK lookup from tableStructure
    const fkMap = new Map<string, { table: string; column: string }>();
    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        for (let i = 0; i < fk.columns.length; i++) {
          const sourceCol = fk.columns[i];
          const targetCol = fk.foreignColumns[i];
          if (sourceCol && targetCol) {
            fkMap.set(sourceCol, {
              table: fk.foreignTable,
              column: targetCol,
            });
          }
        }
      }
    }

    return tableStructure.columns.map((col) => {
      const fkInfo = fkMap.get(col.name);
      return {
        name: col.name,
        dataType: col.db_type,
        nullable: col.nullable,
        enumValues: col.enum_values,
        isPrimaryKey: col.is_pk,
        isForeignKey: !!fkInfo,
        foreignTable: fkInfo?.table,
        foreignColumn: fkInfo?.column,
      };
    });
  }, [tableStructure?.columns, tableStructure?.foreignKeys]);

  // Map DbType to dialect for AI filter
  const dialect = useMemo((): "postgresql" | "mysql" | "sqlite" | "mssql" => {
    switch (dbType) {
      case DbType.PostgreSQL:
        return "postgresql";
      case DbType.MySQL:
      case DbType.MariaDB:
        return "mysql";
      case DbType.SQLite:
        return "sqlite";
      case DbType.SQLServer:
        return "mssql";
      default:
        return "postgresql";
    }
  }, [dbType]);

  // AI filter generator - uses silent prompt to avoid polluting chat history
  const generateAIFilter = useCallback(
    async (
      prompt: string,
      options?: { outputType?: "sql" | "search_pattern" }
    ): Promise<
      | { clause: string; explanation?: string; usedSubquery?: boolean }
      | { error: string }
    > => {
      try {
        // Get available agents (load if needed)
        const acpStore = useAcpStore.getState();
        if (acpStore.availableAgents.length === 0) {
          await acpStore.loadAgents();
        }

        const agents = useAcpStore.getState().availableAgents;
        if (agents.length === 0) {
          return { error: "No AI agents available. Please install an ACP-compatible agent." };
        }

        // Use the selected agent or first available
        const agentId = acpStore.selectedAgentId || agents[0]?.id;
        if (!agentId) {
          return { error: "No AI agent selected." };
        }

        // Build schema context JSON for the AI
        const contextJson = JSON.stringify({
          table: table,
          schema: schema ?? "public",
          database: database ?? "",
          dialect,
          columns: filterColumns.map((c) => ({
            name: c.name,
            type: c.dataType,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
            isForeignKey: c.isForeignKey,
            foreignTable: c.foreignTable,
            foreignColumn: c.foreignColumn,
            enumValues: c.enumValues,
          })),
        });

        // Build the full prompt based on output type
        const fullPrompt =
          options?.outputType === "search_pattern"
            ? `You are a database filter assistant. Generate a search pattern for filtering data.

User request: ${prompt}

Table: ${table} (${dialect})
Columns: ${filterColumns.map((c) => `${c.name} (${c.dataType})`).join(", ")}

IMPORTANT: Only output the search pattern text, no explanation. The pattern will be used for text matching.`
            : `You are a database filter assistant. Generate a SQL WHERE clause for ${dialect}.

User request: ${prompt}

Table: ${table}
Columns: ${filterColumns.map((c) => `${c.name} (${c.dataType})`).join(", ")}

IMPORTANT: Only output the WHERE clause (without WHERE keyword). No explanation. Must be valid ${dialect} SQL.`;

        // Use silent prompt - this does NOT add to chat history
        // Use haiku model for quick filter (fast responses)
        const response = await AcpService.sendSilentPrompt(
          agentId,
          fullPrompt,
          contextJson,
          undefined, // cwd
          DEFAULT_QUICK_FILTER_MODEL,
        );

        // Clean up the response
        let cleanedClause = response
          .replace(/^```(?:sql)?\n?/i, "")
          .replace(/\n?```$/i, "")
          .trim();

        // Remove "WHERE" keyword if the AI included it
        if (cleanedClause.toUpperCase().startsWith("WHERE ")) {
          cleanedClause = cleanedClause.substring(6).trim();
        }

        return {
          clause: cleanedClause,
          explanation: "Generated by AI",
        };
      } catch (error) {
        console.error("AI filter generation error:", error);
        return {
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate AI filter",
        };
      }
    },
    [table, schema, database, dialect, filterColumns]
  );

  // Quick filter hook - manages filter state, parsing, and submission
  const {
    value: quickFilterValue,
    mode: quickFilterMode,
    error: quickFilterError,
    aiExplanation,
    activeFilter,
    isLoading: quickFilterLoading,
    setValue: setQuickFilterValue,
    setMode: setQuickFilterMode,
    submit: handleFilterSubmit,
    clear: clearQuickFilter,
  } = useQuickFilter({
    columns: filterColumns,
    initialFilter: props.initialFilter,
    generateAIFilter,
    clientSideFiltering: false,
    gridId: sortGridId,
  });

  // Warmup silent agent for faster AI filter responses
  // This proactively starts the agent so it's ready when user types #
  useEffect(() => {
    const acpStore = useAcpStore.getState();
    const agentId = acpStore.selectedAgentId;
    if (agentId) {
      void AcpService.warmupSilentAgent(agentId, DEFAULT_QUICK_FILTER_MODEL);
    }
  }, []); // Only on mount

  // Inspector tab state with persistence
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(
    () => (persistedInspector?.tab as InspectorTab) ?? "tree",
  );
  const setInspectorPref = useGridPreferencesStore((s) => s.setInspector);
  useEffect(() => {
    setInspectorPref(gridId, { open: showInspector, tab: inspectorTab });
  }, [gridId, showInspector, inspectorTab, setInspectorPref]);

  // --- Sort Configuration ---
  // Get sort state from grid preferences and convert to SortConfig format
  // Uses sortGridId for per-tab sort isolation (initialization handled by useColumnSorting in BaseDataGrid)
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[sortGridId]?.sortColumns ?? EMPTY_SORT_COLUMNS,
  );

  const sorts = useMemo<SortConfig[]>(() => {
    if (sortColumns.length === 0) return [];

    return sortColumns.map(({ columnId, direction }) => ({
      column: columnId,
      direction,
    }));
  }, [sortColumns]);

  // --- Data Fetching ---
  const tableDataQuery = useTableDataQuery({
    connectionId,
    database: database ?? "",
    schema,
    entityName: table,
    entityType,
    enabled: true,
    embeddedFKs:
      deferredEmbeddedFKs.length > 0 ? deferredEmbeddedFKs : undefined,
    filters: activeFilter,
    sorts, // ← PASS SORT CONFIGURATION
  });

  const {
    data: queryData,
    rows,
    columns: columnMeta,
    estimatedTotal,
    isEstimatedCount,
    status,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = tableDataQuery;

  // Extract execution time from the last page (or first if last is undefined)
  const executionTime =
    queryData?.pages.at(-1)?.executionTimeMs ??
    queryData?.pages[0]?.executionTimeMs;

  const isLoading = status === "loading";
  const isError = status === "error";

  // --- FK Metadata ---
  // Build FK reference map from table structure (needed before columns)
  // Uses { referenced_schema, referenced_table, referenced_column } structure to match TableDataGrid
  const fkReferenceByColumn = useMemo(() => {
    const map = new Map<
      string,
      {
        referenced_schema: string;
        referenced_table: string;
        referenced_column: string;
      }
    >();
    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        if (fk.columns && fk.foreignColumns) {
          for (let i = 0; i < fk.columns.length; i++) {
            const colName = fk.columns[i];
            const refCol = fk.foreignColumns[i];
            if (colName && refCol) {
              map.set(colName, {
                referenced_schema: fk.foreignSchema ?? "public",
                referenced_table: fk.foreignTable,
                referenced_column: refCol,
              });
            }
          }
        }
      }
    }
    return map;
  }, [tableStructure?.foreignKeys]);

  // Build FK references map for useReferencedTableColumns hook (different structure)
  const fkReferencesForHook = useMemo(() => {
    const map = new Map<
      string,
      { schema: string; table: string; column: string }
    >();
    for (const [colName, ref] of fkReferenceByColumn) {
      map.set(colName, {
        schema: ref.referenced_schema,
        table: ref.referenced_table,
        column: ref.referenced_column,
      });
    }
    return map;
  }, [fkReferenceByColumn]);

  // Build a set of PK column names from table structure as a fallback.
  // The streaming path may not include is_pk in column metadata (the Rust backend
  // always sets primary_key: false on streaming ColumnMeta). The table structure's
  // primaryKeys array is derived from constraints and is always reliable.
  const structurePKColumns = useMemo(() => {
    const pks = tableStructure?.primaryKeys;
    if (!pks || pks.length === 0) return null;
    return new Set(pks);
  }, [tableStructure?.primaryKeys]);

  // Convert ColumnMeta[] to GridColumnV2[] with FK metadata
  const columns = useMemo<GridColumnV2[]>(() => {
    const visibleColumns = columnMeta.filter(
      (meta) => !meta.name.startsWith("__qp_fk__"),
    );
    return visibleColumns.map((meta) => {
      const originalIndex = columnMeta.findIndex((c) => c.name === meta.name);
      const uniqueField = `col_${originalIndex}`;
      const fkRef = fkReferenceByColumn.get(meta.name);

      // Enrich is_pk from table structure if the streaming column lacks it
      const isPk = meta.is_pk || (structurePKColumns?.has(meta.name) ?? false);
      const enrichedMeta = isPk !== meta.is_pk ? { ...meta, is_pk: isPk } : meta;

      // Merge FK reference info into column meta (fkRef is already in correct format)
      const mergedMeta = fkRef
        ? {
            ...enrichedMeta,
            fk_reference: fkRef,
            is_fk: true,
          }
        : enrichedMeta;

      // Calculate width - increase for FK columns with embedded values
      let width = computeBaseWidth(meta.name, meta.db_type);
      const embeddedCols = embeddedFKPrefs?.embeddedColumns?.[meta.name];
      const hasEmbeddedFK = embeddedCols && embeddedCols.length > 0;
      if (hasEmbeddedFK) {
        // Wider column to fit "550e…0000 → [embedded_value]" format
        width = Math.max(width, 280);
      }

      return {
        id: meta.name,
        field: uniqueField,
        title: meta.name,
        name: meta.name,
        width,
        type: meta.db_type,
        meta: mergedMeta,
      } as GridColumnV2;
    });
  }, [columnMeta, fkReferenceByColumn, embeddedFKPrefs, structurePKColumns]);

  // Build column name to field mapping
  const columnNameToFieldMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      map.set(col.name, col.field);
    }
    return map;
  }, [columns]);

  // Build field to column mapping
  const columnByFieldMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    for (const col of columns) {
      map.set(col.field, col);
    }
    return map;
  }, [columns]);

  const structureIdentityColumns = useMemo(() => {
    return (
      chooseDeterministicIdentityColumns({
        primaryKeys: tableStructure?.primaryKeys,
        constraints: tableStructure?.constraints,
        indexes: tableStructure?.indexes,
      }) ?? []
    );
  }, [
    tableStructure?.primaryKeys,
    tableStructure?.constraints,
    tableStructure?.indexes,
  ]);

  // Deterministic identity inferred from PK/UNIQUE metadata.
  const deterministicIdentityColumns = useMemo(() => {
    if (structureIdentityColumns.length > 0) {
      return structureIdentityColumns;
    }
    return columns.filter((col) => col.meta?.is_pk).map((col) => col.name);
  }, [columns, structureIdentityColumns]);

  const selectableIdentifierColumns = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const col of columns) {
      const columnName = col.name ?? col.field;
      if (!columnName || columnName.startsWith("__qp_fk__")) continue;
      if (seen.has(columnName)) continue;
      seen.add(columnName);
      result.push(columnName);
    }

    return result;
  }, [columns]);

  const customIdentityColumns = useMemo(() => {
    if (persistedRowIdentifierColumns.length === 0) return [];
    const allowed = new Set(selectableIdentifierColumns);
    return persistedRowIdentifierColumns.filter((column) =>
      allowed.has(column),
    );
  }, [persistedRowIdentifierColumns, selectableIdentifierColumns]);

  useEffect(() => {
    // Wait until columns are available before normalizing persisted identifiers.
    // Otherwise we may clear valid saved columns during initial empty/loading states.
    if (selectableIdentifierColumns.length === 0) {
      return;
    }

    if (
      areStringArraysEqual(persistedRowIdentifierColumns, customIdentityColumns)
    ) {
      return;
    }

    useGridPreferencesStore.getState().setRowIdentifierColumns(
      gridId,
      customIdentityColumns.length > 0 ? customIdentityColumns : undefined,
    );
  }, [
    customIdentityColumns,
    gridId,
    persistedRowIdentifierColumns,
    selectableIdentifierColumns.length,
  ]);

  const hasDeterministicIdentity = deterministicIdentityColumns.length > 0;
  const configuredIdentityColumns = hasDeterministicIdentity
    ? deterministicIdentityColumns
    : customIdentityColumns;
  const rowMatcherMode = hasDeterministicIdentity
    ? "deterministic"
    : "best_effort";
  const hasConfiguredIdentity = configuredIdentityColumns.length > 0;
  const mutationGuardReason =
    !isReadOnly && !hasConfiguredIdentity
      ? "Update/Delete disabled: no primary/unique key"
      : undefined;
  const readOnlyReason = viewReadOnlyReason ?? mutationGuardReason;

  // Row key generation
  const rowKeyMapRef = useRef(new WeakMap<GridRowModel, string>());
  const draftRowCounterRef = useRef(0);
  const columnNameToFieldMapRef = useRef(columnNameToFieldMap);
  columnNameToFieldMapRef.current = columnNameToFieldMap;

  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) {
        return `${schema ?? "public"}.${table}:row-${index}`;
      }
      const cached = rowKeyMapRef.current.get(row);
      if (cached) return cached;

      const parts = configuredIdentityColumns.map((columnName) => {
        const field =
          columnNameToFieldMapRef.current.get(columnName) ?? columnName;
        const cell = row[field];
        const value =
          cell && typeof cell === "object" && "value" in cell
            ? cell.value
            : cell;
        if (value === null || value === undefined) return "__null__";
        if (typeof value !== "object") return String(value);
        return String(value);
      });

      let computed = `${schema ?? "public"}.${table}:row-${draftRowCounterRef.current++}`;
      if (
        configuredIdentityColumns.length > 0 &&
        parts.some((part) => part !== "__null__")
      ) {
        computed = `${schema ?? "public"}.${table}:pk:${parts.join("|")}`;
      }
      rowKeyMapRef.current.set(row, computed);
      return computed;
    },
    [configuredIdentityColumns, schema, table],
  );

  const bestEffortIdentityColumns = useMemo(() => {
    const filteredColumns = columns
      .map((col) => col.name ?? col.field)
      .filter((columnName) => !columnName.startsWith("__qp_fk__"));
    return filteredColumns.length > 0
      ? filteredColumns
      : columns.map((col) => col.name ?? col.field);
  }, [columns]);

  // --- Command Factory ---
  // Creates SQL-specific CRUD commands for BaseDataGrid to use
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    if (isReadOnly) return undefined;

    const target = createCrudTarget(
      connectionId,
      database ?? "",
      schema,
      table,
    );

    return {
      connectionId,
      database,
      schema,
      table,
      primaryKeyColumns: configuredIdentityColumns,
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey,

      createEditCommand: (event: GridEditCommitEvent) => {
        try {
          const identityColumns =
            configuredIdentityColumns.length > 0
              ? configuredIdentityColumns
              : bestEffortIdentityColumns;

          return createUpdateCommand(event, target, columns, {
            identityColumns,
            matcherMode: rowMatcherMode,
          });
        } catch (err) {
          console.error("Failed to create update command:", err);
          return null;
        }
      },

      createInsertCommand: (data?: Record<string, unknown>) => {
        // Create a new row with default values
        const newRow: GridRowModel = {};
        columns.forEach((col) => {
          const providedValue = data?.[col.name];
          if (providedValue !== undefined) {
            newRow[col.field] = {
              value: providedValue,
              value_type:
                typeof providedValue === "number" ? "Integer" : "Text",
              db_type: col.meta?.db_type ?? col.type ?? "text",
              is_truncated: false,
            } as GridCellValue;
          } else if (
            col.meta?.default ||
            col.meta?.nullable ||
            col.meta?.is_pk
          ) {
            newRow[col.field] = {
              value: null,
              value_type: "Null",
              db_type: col.meta?.db_type ?? col.type ?? "text",
              is_truncated: false,
            } as GridCellValue;
          } else {
            newRow[col.field] = {
              value: "",
              value_type: "Text",
              db_type: col.meta?.db_type ?? col.type ?? "text",
              is_truncated: false,
            } as GridCellValue;
          }
        });
        return createInsertCommand(newRow, target, columns);
      },

      createDeleteCommand: (row: GridRowModel, _rowKey: string) => {
        const identityColumns =
          configuredIdentityColumns.length > 0
            ? configuredIdentityColumns
            : bestEffortIdentityColumns;
        return createDeleteCommand(row, target, columns, {
          identityColumns,
          matcherMode: rowMatcherMode,
        });
      },

      validateCommand: async (command) => {
        if (command.type !== "data.update" && command.type !== "data.delete") {
          return { valid: true };
        }

        const tags = command.metadata.tags ?? [];
        if (!tags.includes("matcher:best_effort")) {
          return { valid: true };
        }

        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
          tempId?: string;
        };

        // UPDATE commands linked to a staged INSERT (via tempId) should not probe
        // live DB rows. The command will be merged into INSERT payload in store.
        if (command.type === "data.update" && payload.tempId) {
          return { valid: true };
        }

        const where = payload.primaryKeys;
        try {
          const adapter = await getAdapterForConnection(connectionId);
          const probeResult = await canProceedBestEffort({
            adapter:
              (adapter as unknown) as Parameters<
                typeof canProceedBestEffort
              >[0]["adapter"],
            target: { schema, table },
            where: where ?? {},
          });

          if (probeResult.ok) {
            return { valid: true };
          }

          if (probeResult.reason === "invalid_matcher") {
            return {
              valid: false,
              reason: "Best-effort blocked: no row matcher values were provided",
            };
          }

          if (probeResult.reason === "not_found") {
            return {
              valid: false,
              reason: "Best-effort blocked: row no longer matches current values",
            };
          }

          return {
            valid: false,
            reason: "Best-effort blocked: multiple rows match current values",
          };
        } catch (error) {
          return {
            valid: false,
            reason: `Best-effort validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      },
    };
  }, [
    isReadOnly,
    connectionId,
    database,
    schema,
    table,
    columns,
    bestEffortIdentityColumns,
    configuredIdentityColumns,
    rowMatcherMode,
    columnNameToFieldMap,
    columnByFieldMap,
    getRowKey,
  ]);

  // Build embedded FK field map from columnMeta
  // The backend returns embedded FK values as columns named __qp_fk__{fkColumn}__{refColumn}
  // Map: fkColumn -> col_N[] (fields to access embedded values, supports multiple)
  const embeddedFKFieldMap = useMemo(() => {
    const map = new Map<string, string[]>();
    columnMeta.forEach((col, index) => {
      // Parse __qp_fk__{fkColumn}__{refColumn}
      if (col.name.startsWith("__qp_fk__")) {
        const match = col.name.match(/^__qp_fk__(.+?)__(.+)$/);
        if (match && match[1]) {
          const existing = map.get(match[1]) ?? [];
          existing.push(`col_${index}`);
          map.set(match[1], existing);
        }
      }
    });
    return map;
  }, [columnMeta]);

  const embeddedFKFieldMapRef = useRef(embeddedFKFieldMap);
  embeddedFKFieldMapRef.current = embeddedFKFieldMap;

  // Staged FK embedded values for updates
  const stagedFKEmbeddedValuesRef = useRef<Map<string, string | null>>(
    new Map(),
  );

  // --- Referenced Table Columns (for context menu) ---
  const referencedTableColumns = useReferencedTableColumns({
    connectionId,
    database: database ?? "",
    fkReferences: fkReferencesForHook,
    enabled: fkReferencesForHook.size > 0,
  });

  // --- Stable refs for getCellContent ---
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  // --- getCellContent (follows TableDataGrid pattern exactly) ---
  // This is used instead of customGetCellContent because embedded FK values
  // need to be passed TO buildGridCellV2, not patched after the fact.
  // IMPORTANT: Prefer BaseDataGrid's context row/column so rendering and
  // operations share the same row-index mapping (single source of truth).
  const getCellContent = useCallback(
    (cell: Item, context?: GridCellContentContext): GridCell => {
      const [colIndex, rowIndex] = cell;
      const resolvedRowIndex = context?.rowIndex ?? rowIndex;
      const column = context?.column ?? columnsRef.current[colIndex];
      const row = context?.row ?? rows[resolvedRowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        } as const;
      }

      const cellValue = row[column.field] as GridCellValue | null | undefined;

      // Extract embedded FK value if this is an FK column
      // Priority: 1) Staged FK embedded value (from picker selection) 2) Row data
      let embeddedValue: string | null | undefined;
      if (column.meta?.is_fk && column.name) {
        const columnName = column.name;
        const stagedKey = `${resolvedRowIndex}:${columnName}`;
        const stagedEmbedded = stagedFKEmbeddedValuesRef.current.get(stagedKey);

        // Check if there's a staged embedded value for this FK cell
        if (stagedEmbedded !== undefined) {
          embeddedValue = stagedEmbedded;
        } else {
          // Fall back to embedded FK fields from row data (supports multiple)
          const embeddedFields = embeddedFKFieldMapRef.current.get(columnName);
          if (embeddedFields) {
            const parts: string[] = [];
            for (const field of embeddedFields) {
              const embeddedCell = row[field] as
                | GridCellValue
                | null
                | undefined;
              if (embeddedCell?.value != null) {
                parts.push(String(embeddedCell.value));
              }
            }
            if (parts.length > 0) {
              embeddedValue = parts.join(" · ");
            }
          }
        }
      }

      // Build the cell with embeddedValue passed to buildGridCellV2
      // (This is the key pattern from TableDataGrid that was missing)
      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
        embeddedValue,
        connectionContext: {
          connectionId,
          database,
          schema: schema ?? "public",
          table,
        },
      });

      return gridCell;
    },
    [isReadOnly, connectionId, database, schema, table, rows],
  );

  // --- Cell Edit Callback (for FK embedded value extraction) ---
  const handleCellEditCommit = useCallback((event: GridEditCommitEvent) => {
    // For FK columns, extract and store the embeddedValue from the committed cell
    if (
      event.column.meta?.is_fk &&
      event.newValue &&
      "data" in event.newValue
    ) {
      const data = event.newValue.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "embeddedValue" in data
      ) {
        const columnName = event.column.name ?? event.column.field;
        const key = `${event.rowIndex}:${columnName}`;
        const embeddedValue = (data as { embeddedValue?: string | null })
          .embeddedValue;
        stagedFKEmbeddedValuesRef.current.set(key, embeddedValue ?? null);
      }
    }
  }, []);

  // --- Reconnect Handler ---
  const handleReconnect = useCallback(async () => {
    try {
      await databaseService.getConnectionHealth(connectionId);
      refetch();
    } catch {
      refetch(); // Still try to refetch even if health check fails
    }
  }, [connectionId, refetch]);

  const canConfigureIdentifierColumns =
    !isReadOnly &&
    !hasDeterministicIdentity &&
    selectableIdentifierColumns.length > 0;

  const handleSelectIdentifierColumns = useCallback(() => {
    setShowIdentifierSelector(true);
  }, []);

  const handleToggleIdentifierColumn = useCallback(
    (column: string) => {
      const nextColumns = customIdentityColumns.includes(column)
        ? customIdentityColumns.filter((item) => item !== column)
        : [...customIdentityColumns, column];

      useGridPreferencesStore.getState().setRowIdentifierColumns(
        gridId,
        nextColumns.length > 0 ? nextColumns : undefined,
      );
    },
    [customIdentityColumns, gridId],
  );

  const handleClearIdentifierColumns = useCallback(() => {
    useGridPreferencesStore.getState().setRowIdentifierColumns(
      gridId,
      undefined,
    );
  }, [gridId]);

  const handleCancelIdentifierColumns = useCallback(() => {
    setShowIdentifierSelector(false);
  }, []);

  // View mode toggle (Table / Tree / JSON) — must be before early returns
  const persistedViewMode = useGridPreferencesStore(
    (s) => s.preferences[gridId]?.dataViewMode,
  );
  const setPersistedViewMode = useGridPreferencesStore((s) => s.setDataViewMode);
  const [viewMode, setViewModeLocal] = useState<"table" | "tree" | "json">(
    () => persistedViewMode ?? "table",
  );
  const setViewMode = useCallback(
    (mode: "table" | "tree" | "json") => {
      setViewModeLocal(mode);
      setPersistedViewMode(gridId, mode === "table" ? undefined : mode);
    },
    [gridId, setPersistedViewMode],
  );

  // CRUD store for tree view edits
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const expandCollapseRef = useRef<{ expandAll: () => void; collapseAll: () => void } | null>(null);
  const unstageCommands = useCrudStore((s) => s.unstageCommands);
  const tableKey = useMemo(
    () => `${connectionId}:${database ?? ""}:${schema ?? "public"}:${table}`,
    [connectionId, database, schema, table],
  );
  const stagedCommands = useCrudStore((s) => s.stagedCommands.get(tableKey));

  // Set of document PKs that have staged edits (for tree view undo button)
  const stagedDocIds = useMemo(() => {
    if (!stagedCommands || stagedCommands.length === 0 || !configuredIdentityColumns.length) return undefined;
    const ids = new Set<string>();
    for (const cmd of stagedCommands) {
      if (cmd.type !== "data.update" || cmd.state !== "staged") continue;
      const pk = (cmd.payload as { primaryKeys?: Record<string, unknown> }).primaryKeys;
      if (!pk) continue;
      const key = configuredIdentityColumns.map((col) => String(pk[col] ?? "")).join("·");
      ids.add(key);
    }
    return ids.size > 0 ? ids : undefined;
  }, [stagedCommands, configuredIdentityColumns]);

  // Convert SQL rows to plain objects for tree/JSON views
  const plainDocuments = useMemo(() => {
    if (viewMode === "table") return [];
    const fieldToName = new Map<string, string>();
    const internalFields = new Set<string>();
    columnMeta.forEach((meta, index) => {
      const field = `col_${index}`;
      if (meta.name.startsWith("__qp_fk__")) {
        internalFields.add(field);
      } else {
        fieldToName.set(field, meta.name);
      }
    });
    return rows.map((row) => {
      const doc: Record<string, unknown> = {};
      for (const [field, cell] of Object.entries(row)) {
        if (field.startsWith("__") || internalFields.has(field)) continue;
        const name = fieldToName.get(field) ?? field;
        doc[name] = cell && typeof cell === "object" && "value" in cell
          ? (cell as { value: unknown }).value
          : cell;
      }
      return doc;
    });
  }, [rows, columnMeta, viewMode]);

  // Overlay staged edits + inserts on plainDocuments for tree/JSON views
  const documentsWithStagedEdits = useMemo(() => {
    if (viewMode === "table" || !stagedCommands || stagedCommands.length === 0)
      return plainDocuments;

    // Collect field edits by PK key
    const editsByPk = new Map<string, Map<string, unknown>>();
    const stagedInserts: Record<string, unknown>[] = [];

    for (const cmd of stagedCommands) {
      if (cmd.state !== "staged") continue;

      if (cmd.type === "data.update") {
        const payload = cmd.payload as {
          primaryKeys?: Record<string, unknown>;
          column?: string;
          newValue?: unknown;
        };
        if (!payload.primaryKeys || !payload.column) continue;
        const pkKey = configuredIdentityColumns
          .map((col) => String(payload.primaryKeys![col] ?? ""))
          .join("·");
        if (!editsByPk.has(pkKey)) editsByPk.set(pkKey, new Map());
        editsByPk.get(pkKey)!.set(payload.column, payload.newValue);
      }

      if (cmd.type === "data.insert") {
        const payload = cmd.payload as { values?: Record<string, unknown> };
        if (payload.values) stagedInserts.push(payload.values);
      }
    }

    let result = plainDocuments;
    if (editsByPk.size > 0) {
      result = plainDocuments.map((doc) => {
        const pkKey = configuredIdentityColumns
          .map((col) => String(doc[col] ?? ""))
          .join("·");
        const edits = editsByPk.get(pkKey);
        if (!edits) return doc;

        const patched = { ...doc };
        for (const [field, newValue] of edits) {
          patched[field] = newValue;
        }
        return patched;
      });
    }

    if (stagedInserts.length > 0) {
      result = [...result, ...stagedInserts];
    }

    return result;
  }, [plainDocuments, stagedCommands, configuredIdentityColumns, viewMode]);

  // --- Loading States ---
  if (isLoading) {
    return <DataGridSkeleton />;
  }

  // Don't hide the grid when empty - keep headers/filters visible
  // Show overlay message inside the grid instead

  // --- Render ---
  return (
    <div className="flex h-full flex-col relative">
      {/* Quick Filter + View Mode Toggle + Inspector */}
      <div className="py-1.5 px-1">
        <div className="flex items-center gap-2">
          {filterColumns.length > 0 && (
            <div className="flex-1 min-w-0">
              <QuickFilter
                ref={quickFilterRef}
                columns={filterColumns}
                value={quickFilterValue}
                mode={quickFilterMode}
                onValueChange={setQuickFilterValue}
                onModeChange={setQuickFilterMode}
                onSubmit={handleFilterSubmit}
                onClear={clearQuickFilter}
                isLoading={quickFilterLoading}
                error={quickFilterError}
                explanation={aiExplanation}
                clientSideFiltering={false}
              />
            </div>
          )}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "table" | "tree" | "json")}>
            <TabsList>
              <TabsTrigger value="table"><IconTable /> Table</TabsTrigger>
              <TabsTrigger value="tree"><IconListTree /> Tree</TabsTrigger>
              <TabsTrigger value="json"><IconBraces /> JSON</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7 shrink-0"
            onClick={() => {
              setShowInspector((prev) => !prev);
            }}
          >
            {showInspector ? (
              <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
            ) : (
              <IconLayoutSidebarRightExpand className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* BaseDataGrid handles all CRUD operations internally */}
      {viewMode !== "table" && (
        <div className="flex-1 min-h-0 flex flex-col">
          {viewMode === "tree" ? (
            <DocumentTreeView
              documents={documentsWithStagedEdits}
              className="min-h-0 flex-1 px-1.5"
              gridId={gridId}
              identifierFields={configuredIdentityColumns.length > 0 ? configuredIdentityColumns : undefined}
              hasMore={hasNextPage}
              isLoadingMore={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              editable={!isReadOnly && hasConfiguredIdentity}
              allowStructuralEdits={false}
              onExpandCollapseRef={expandCollapseRef}
              stagedDocIds={stagedDocIds}
              onFieldEdit={(docIndex, fieldPath, newValue) => {
                if (!commandFactory) return;
                const doc = plainDocuments[docIndex];
                if (!doc) return;
                // Build primary keys from identifierFields
                const primaryKeys: Record<string, JsonValue> = {};
                for (const col of configuredIdentityColumns) {
                  primaryKeys[col] = (doc[col] ?? null) as JsonValue;
                }
                const cmd: CrudCommand = {
                  id: nanoid(),
                  type: "data.update",
                  target: { connectionId, database: database ?? "", schema, table },
                  payload: {
                    column: fieldPath,
                    primaryKeys,
                    oldValue: (doc[fieldPath] ?? null) as JsonValue,
                    newValue: newValue as JsonValue,
                  },
                  metadata: {
                    timestamp: new Date().toISOString(),
                    description: `Update ${fieldPath}`,
                  },
                  state: "staged",
                };
                stageCommand(cmd);
              }}
              onDocumentUndo={(docIndex) => {
                if (!stagedCommands) return;
                const doc = plainDocuments[docIndex];
                if (!doc) return;
                const pkKey = configuredIdentityColumns.map((col) => String(doc[col] ?? "")).join("·");
                const idsToUnstage = stagedCommands
                  .filter((cmd) => {
                    if (cmd.type !== "data.update" || cmd.state !== "staged") return false;
                    const pk = (cmd.payload as { primaryKeys?: Record<string, unknown> }).primaryKeys;
                    if (!pk) return false;
                    const key = configuredIdentityColumns.map((col) => String(pk[col] ?? "")).join("·");
                    return key === pkKey;
                  })
                  .map((cmd) => cmd.id);
                if (idsToUnstage.length > 0) unstageCommands(idsToUnstage);
              }}
              onInsertDocument={!isReadOnly && commandFactory ? (doc) => {
                const cmd = commandFactory.createInsertCommand?.(doc);
                if (cmd) stageCommand(cmd);
              } : undefined}
              onDeleteDocument={!isReadOnly && commandFactory ? (docIndex) => {
                const doc = plainDocuments[docIndex];
                if (!doc || !configuredIdentityColumns.length) return;
                const primaryKeys: Record<string, JsonValue> = {};
                for (const col of configuredIdentityColumns) {
                  primaryKeys[col] = (doc[col] ?? null) as JsonValue;
                }
                const cmd: CrudCommand = {
                  id: nanoid(),
                  type: "data.delete",
                  target: { connectionId, database: database ?? "", schema, table },
                  payload: { primaryKeys },
                  metadata: {
                    timestamp: new Date().toISOString(),
                    description: "Delete row",
                  },
                  state: "staged",
                };
                stageCommand(cmd);
              } : undefined}
            />
          ) : (
            <DocumentJsonView
              documents={documentsWithStagedEdits}
              className="min-h-0 flex-1"
            />
          )}
          <DataGridStatusBar
            loadedRows={rows.length}
            estimatedTotal={estimatedTotal}
            isEstimatedCount={isEstimatedCount}
            hasMore={hasNextPage}
            executionTime={executionTime}
            leftContent={viewMode === "tree" ? (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => expandCollapseRef.current?.expandAll()} className="text-[11px] hover:text-foreground">Expand All</button>
                <span className="text-border/50">|</span>
                <button type="button" onClick={() => expandCollapseRef.current?.collapseAll()} className="text-[11px] hover:text-foreground">Collapse All</button>
              </div>
            ) : undefined}
          />
        </div>
      )}
      <div style={{ display: viewMode === "table" ? undefined : "none" }} className="flex-1 min-h-0">
      <BaseDataGrid
        gridId={gridId}
        sortGridId={sortGridId !== gridId ? sortGridId : undefined}
        rows={rows}
        columns={columns}
        connectionId={connectionId}
        database={database}
        schema={schema}
        tableName={tableName}
        paradigm="sql"
        dialect={dialect}
        estimatedTotal={estimatedTotal}
        isEstimatedCount={isEstimatedCount}
        hasMore={hasNextPage}
        onLoadMore={fetchNextPage}
        isLoadingMore={isFetchingNextPage}
        readOnly={isReadOnly}
        readOnlyReason={readOnlyReason}
        onSelectIdentifierColumns={
          canConfigureIdentifierColumns ? handleSelectIdentifierColumns : undefined
        }
        identifierSelector={
          canConfigureIdentifierColumns
            ? {
                open: showIdentifierSelector,
                tableName,
                availableColumns: selectableIdentifierColumns,
                selectedColumns: customIdentityColumns,
                onToggleColumn: handleToggleIdentifierColumn,
                onClear: handleClearIdentifierColumns,
                onCancel: handleCancelIdentifierColumns,
              }
            : undefined
        }
        entityType={entityType}
        enableFiltering={false} // Filter managed by SqlDataGrid, not BaseDataGrid
        enableSorting={true}
        enableExport={true}
        enableRowPinning={true}
        enableColumnManagement={true}
        enableClipboard={true}
        enableFillOperations={!isReadOnly}
        enableStagedChanges={!isReadOnly}
        // Command factory for CRUD operations
        commandFactory={commandFactory}
        // Callback for FK embedded value extraction
        onCellEditCommit={handleCellEditCommit}
        // FK data
        referencedTableColumns={referencedTableColumns}
        // Complete getCellContent override for FK embedded value display
        // (follows TableDataGrid pattern - passes embeddedValue to buildGridCellV2)
        getCellContent={getCellContent}
        // Data invalidation refetch
        onRefetch={refetch}
        // Error handling and reconnection
        error={
          isError
            ? error instanceof Error
              ? error.message
              : "Failed to load table data"
            : undefined
        }
        onReconnect={handleReconnect}
        // Query performance metrics
        executionTime={executionTime}
        // Focus management
        focused={focused}
        inspectorOpen={showInspector}
        onInspectorOpenChange={setShowInspector}
        inspectorDefaultTab={inspectorTab}
        onInspectorTabChange={setInspectorTab}
        showInspectorToggleButton={false}
        // Pass QuickFilter ref for Cmd+F handling (since we manage our own QuickFilter)
        externalQuickFilterRef={quickFilterRef}
        className={cn("flex-1", className)}
      />
      </div>

      {/* Empty state overlay - shown when no rows but grid/filters remain visible */}
      {!isError && rows.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-2 p-8">
            <div className="text-muted-foreground text-sm font-medium">
              {isViewOrMatView ? "No rows in this view" : "No data"}
            </div>
            <div className="text-muted-foreground/70 text-xs">
              {isViewOrMatView
                ? "This view contains no data"
                : "No rows found" +
                  (quickFilterValue ? " matching your filter" : "")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
