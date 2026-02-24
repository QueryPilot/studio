import { logger } from "@/lib/logger";
import { batchWithConcurrency } from "@/utils/batch";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { CodeEditor, type CodeEditorRef } from "@/components/CodeEditor";
import { ERDToolbar, type LayoutDirection } from "./ERDToolbar";
import { ERDVisualizerPlaceholder } from "./ERDVisualizerPlaceholder";
import { ERDVisualizer, type ERDVisualizerRef } from "./ERDVisualizer";
import { ReactFlowProvider, getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { Parser, exporter as dbmlExporter } from "@dbml/core";
import { toPng, toSvg } from "html-to-image";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri";
import { toast } from "sonner";

import {
  dbmlService,
  type DBMLSchema,
  type DBMLRelationship,
} from "@/services/dbmlService";
import { databaseService } from "@/services/databaseService";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type { TableStructure, ForeignKeyInfo } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";
import { erdCache } from "@/services/erdCache";
import {
  useErdStore,
  type NodePosition,
  type ViewportState,
} from "@/stores/erdStore";
import {
  ConstraintType,
  type Constraint,
  type Index,
  type Trigger,
} from "@/types/tableStructure";

const DEFAULT_SCHEMA = "public";
const PARSE_DEBOUNCE_MS = 500;

const relationToCardinality = (relation?: string | null): "1" | "n" => {
  if (!relation) return "1";
  const normalized = relation.toLowerCase();
  if (
    normalized.includes("*") ||
    normalized.includes("n") ||
    normalized.includes("many")
  ) {
    return "n";
  }
  return "1";
};

interface ERDPanelProps {
  connectionId: string;
  tabId: string;
  database?: string;
  schema?: string;
}

export const ERDPanel: React.FC<ERDPanelProps> = ({
  connectionId,
  tabId,
  database,
  schema,
}) => {
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const [dbmlDocument, setDbmlDocument] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<DBMLRelationship[]>([]);
  const [tables, setTables] = useState<TableStructure[]>([]);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("TB");
  const [_schemas, setSchemas] = useState<string[]>(() =>
    schema ? [schema] : [DEFAULT_SCHEMA],
  );
  const [selectedSchema, setSelectedSchema] = useState<string>(
    schema ?? DEFAULT_SCHEMA,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const lastConnectionRef = useRef<string | null>(connectionId);
  const skipParseNextRef = useRef<boolean>(false);
  const parseTimerRef = useRef<number | undefined>(undefined);
  const erdVisualizerRef = useRef<ERDVisualizerRef | null>(null);
  const editorRef = useRef<CodeEditorRef>(null);
  const dbmlWorkerRef = useRef<Worker | null>(null);
  const diagramContainerRef = useRef<HTMLDivElement>(null);

  // Local view ID - each ERD tab tracks its own view instead of global activeViewId
  const [localViewId, setLocalViewId] = useState<string | null>(null);

  const ensureView = useErdStore((state) => state.ensureView);
  // Get the view for THIS tab using localViewId, not the global activeViewId
  const localView = useErdStore((state) =>
    localViewId ? state.views[localViewId] ?? null : null,
  );
  const updateView = useErdStore((state) => state.updateView);
  const saveNodePosition = useErdStore((state) => state.saveNodePosition);
  const saveViewport = useErdStore((state) => state.saveViewport);

  const storedConnection = useConnectionStore(
    (state) =>
      state.connections.find((item) => item.profile.id === connectionId) || null,
  );
  const connection = storedConnection?.profile || null;

  const targetDatabase = database ?? connection?.database ?? "";

  // Initialize layout direction from localView
  useEffect(() => {
    if (localView?.layoutDirection) {
      setLayoutDirection(localView.layoutDirection);
    }
  }, [localView?.layoutDirection]);

  // Initialize and manage web worker lifecycle
  useEffect(() => {
    // Create worker on mount
    if (!dbmlWorkerRef.current) {
      dbmlWorkerRef.current = new Worker(
        new URL("@/workers/dbmlParser.worker.ts", import.meta.url),
        { type: "module" },
      );
    }

    // Clean up worker on unmount
    return () => {
      if (dbmlWorkerRef.current) {
        dbmlWorkerRef.current.terminate();
        dbmlWorkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (lastConnectionRef.current !== connectionId) {
      lastConnectionRef.current = connectionId;
      const initialSchema = schema ?? DEFAULT_SCHEMA;
      setSelectedSchema(initialSchema);
      setSchemas([initialSchema]);
      skipParseNextRef.current = true;
      setDbmlDocument("");
      setParseError(null);
      setError(null);
      setTables([]);
      setRelationships([]);
    }
  }, [connectionId, schema]);

  useEffect(() => {
    let cancelled = false;

    const fetchSchemas = async () => {
      if (!connectionId) return;
      if (!targetDatabase) {
        setSchemas((prev) => (prev.length ? prev : [selectedSchema]));
        return;
      }

      try {
        const result = await databaseService.listSchemas(
          connectionId,
          targetDatabase,
        );
        if (cancelled) return;
        if (result.length > 0) {
          setSchemas(result);
          if (!result.includes(selectedSchema)) {
            setSelectedSchema(result[0] ?? DEFAULT_SCHEMA);
          }
        } else {
          setSchemas((prev) => (prev.length ? prev : [selectedSchema]));
        }
      } catch (err) {
        logger.error("Failed to load schemas for ERD", err);
        if (!cancelled) {
          setSchemas((prev) => (prev.length ? prev : [selectedSchema]));
        }
      }
    };

    void fetchSchemas();
    return () => {
      cancelled = true;
    };
  }, [connectionId, targetDatabase, selectedSchema]);

  const loadSchemaData = useCallback(
    async (schemaName: string, options?: { force?: boolean }) => {
      if (!connectionId) return;

      const viewId = ensureView({
        connectionId,
        database: targetDatabase,
        schema: schemaName,
        name: `${schemaName} schema`,
      });
      setLocalViewId(viewId);

      const cacheHit = options?.force
        ? null
        : erdCache.get(connectionId, targetDatabase, schemaName);

      if (cacheHit) {
        skipParseNextRef.current = true;
        setDbmlDocument(cacheHit.dbml);
        setTables(cacheHit.tables);
        setRelationships(cacheHit.relationships);
        setError(null);
        setParseError(null);
        setLoading(false);
        updateView(viewId, {
          dbml: cacheHit.dbml,
          tableCount: cacheHit.metadata.tableCount,
          relationshipCount: cacheHit.metadata.relationshipCount,
        });
        return;
      }

      setLoading(true);
      setError(null);
      setParseError(null);
      setTables([]);
      setRelationships([]);

      try {
        const tableMetas = await databaseService.listTables(
          connectionId,
          targetDatabase,
          schemaName,
        );

        // Filter to only regular tables, excluding partitioned tables and views
        const baseTables = tableMetas.filter(
          (table) => table.kind === "Table" && !table.isPartitioned
        );

        if (baseTables.length === 0) {
          const emptySchema: DBMLSchema = {
            dbml: "// No tables found for schema",
            ast: null,
            metadata: {
              tableCount: 0,
              relationshipCount: 0,
              enumCount: 0,
              version: "1.0",
              generatedAt: new Date(),
            },
            relationships: [],
            tables: [],
          };

          skipParseNextRef.current = true;
          setDbmlDocument(emptySchema.dbml);
          setTables([]);
          setRelationships([]);
          setError(null);
          updateView(viewId, {
            dbml: emptySchema.dbml,
            tableCount: 0,
            relationshipCount: 0,
          });
          erdCache.set(connectionId, targetDatabase, schemaName, emptySchema);
          return;
        }

        // Fetch table structures with limited concurrency to avoid overwhelming
        // the database connection pool (especially for MySQL/MariaDB with many tables).
        // ERD only needs columns and constraints, not triggers or stats.
        const structures = await batchWithConcurrency(
          baseTables,
          (table) =>
            databaseService.getTableStructure(
              connectionId,
              targetDatabase,
              table.schema,
              table.name,
              {
                includeIndexes: true,
                includeConstraints: true,
                includeForeignKeys: true,
                includeTriggers: false,
                includeStatistics: false,
              },
            ),
          5, // Limit to 5 concurrent table fetches
        );

        const result = await dbmlService.schemaToDBML(structures, {
          databaseType: connection?.db_type,
        });

        skipParseNextRef.current = true;
        setDbmlDocument(result.dbml);
        // Use tables from result which have the properly marked columns
        setTables(result.tables);
        setRelationships(result.relationships);
        setError(null);
        erdCache.set(connectionId, targetDatabase, schemaName, result);
        updateView(viewId, {
          dbml: result.dbml,
          tableCount: result.metadata.tableCount,
          relationshipCount: result.metadata.relationshipCount,
        });
      } catch (err) {
        logger.error("Failed to load ERD schema", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load schema metadata.",
        );
        setTables([]);
        setRelationships([]);
      } finally {
        setLoading(false);
      }
    },
    [
      connectionId,
      targetDatabase,
      ensureView,
      connection?.db_type,
      updateView,
    ],
  );

  useEffect(() => {
    if (!connectionId || !selectedSchema) return;
    void loadSchemaData(selectedSchema);
  }, [connectionId, selectedSchema, loadSchemaData]);

  useEffect(() => {
    if (
      localView?.dbml &&
      !skipParseNextRef.current &&
      localView.dbml !== dbmlDocument
    ) {
      setDbmlDocument(localView.dbml);
    }
  }, [localView?.dbml, dbmlDocument]);

  const handleRefresh = () => {
    void loadSchemaData(selectedSchema, { force: true });
  };

  const handleExportImage = useCallback(async (format: "png" | "svg") => {
    const viewportEl = diagramContainerRef.current?.querySelector(
      ".react-flow__viewport",
    ) as HTMLElement | null;
    const instance = erdVisualizerRef.current;
    if (!viewportEl || !instance) {
      toast.error("No diagram to export");
      return;
    }

    setIsExporting(true);
    try {
      // Calculate bounds of all nodes to export full content (not just visible area)
      const allNodes = instance.getNodes();
      const nodesBounds = getNodesBounds(allNodes);

      const PADDING = 50;
      const imageWidth = Math.ceil(nodesBounds.width + PADDING * 2);
      const imageHeight = Math.ceil(nodesBounds.height + PADDING * 2);

      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        1, // minZoom - export at 1:1
        1, // maxZoom - export at 1:1
        PADDING,
      );

      const exportFn = format === "png" ? toPng : toSvg;
      const dataUrl = await exportFn(viewportEl, {
        backgroundColor: "white",
        quality: 1,
        pixelRatio: 2,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          if (node.classList.contains("react-flow__minimap")) return false;
          if (node.classList.contains("react-flow__controls")) return false;
          return true;
        },
      });

      const filename = `erd-${selectedSchema}.${format}`;

      if (isTauri()) {
        const filePath = await save({
          defaultPath: filename,
          filters: [
            {
              name: format === "png" ? "PNG Image" : "SVG Image",
              extensions: [format],
            },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (filePath) {
          // Convert data URL to binary and write via Tauri
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          await invoke("plugin:fs|write_file", {
            path: filePath,
            contents: Array.from(new Uint8Array(arrayBuffer)),
          });
          toast.success(`ERD exported as ${format.toUpperCase()}`);
        }
      } else {
        const link = document.createElement("a");
        link.download = filename;
        link.href = dataUrl;
        link.click();
        toast.success(`ERD exported as ${format.toUpperCase()}`);
      }
    } catch (err) {
      logger.error("Failed to export ERD", err);
      toast.error("Failed to export diagram");
    } finally {
      setIsExporting(false);
    }
  }, [selectedSchema]);

  const handleExportSQL = useCallback(async (format: "postgres" | "mysql" | "mssql" | "oracle") => {
    if (!dbmlDocument.trim()) {
      toast.error("No DBML to export");
      return;
    }

    const formatLabels: Record<string, string> = {
      postgres: "PostgreSQL",
      mysql: "MySQL",
      mssql: "SQL Server",
      oracle: "Oracle",
    };

    try {
      const sql = dbmlExporter.export(dbmlDocument, format);

      if (isTauri()) {
        const filePath = await save({
          defaultPath: `erd-${selectedSchema}.sql`,
          filters: [
            { name: "SQL Files", extensions: ["sql"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (filePath) {
          await invoke("plugin:fs|write_text_file", {
            path: filePath,
            contents: sql,
          });
          toast.success(`${formatLabels[format]} SQL exported`);
        }
      } else {
        void navigator.clipboard.writeText(sql).then(() => {
          toast.success(`${formatLabels[format]} SQL copied to clipboard`);
        });
      }
    } catch (err) {
      logger.error("Failed to export SQL", err);
      toast.error(`Failed to export ${formatLabels[format]} SQL - check DBML syntax`);
    }
  }, [dbmlDocument, selectedSchema]);

  const handleNodePositionsChange = useCallback(
    (positions: Record<string, NodePosition>) => {
      if (!localViewId) return;
      // When all positions are updated at once (auto-arrange), reset hasManualPositions
      updateView(localViewId, { nodePositions: positions, hasManualPositions: false });
    },
    [localViewId, updateView],
  );

  const handleNodePositionChange = useCallback(
    (nodeId: string, position: NodePosition) => {
      if (!localViewId) return;
      saveNodePosition(localViewId, nodeId, position);
    },
    [localViewId, saveNodePosition],
  );

  const handleViewportChange = useCallback(
    (viewport: ViewportState) => {
      if (!localViewId) return;
      saveViewport(localViewId, viewport);
    },
    [localViewId, saveViewport],
  );

  type ParserField = {
    name: string;
    type?: { type_name?: string; name?: string };
    not_null?: boolean;
    pk?: boolean;
    dbdefault?: { value?: unknown };
    note?: string | { text?: string };
  };

  type ParserTable = {
    name: string;
    fields: ParserField[];
    note?: string | { text?: string };
  };

  type ParserEndpoint = {
    relation?: string;
    schemaName?: string | null;
    tableName: string;
    fieldNames: string[];
  };

  type ParserRef = {
    name?: string | null;
    onDelete?: string;
    onUpdate?: string;
    endpoints?: ParserEndpoint[];
  };

  type ParserSchema = {
    name?: string;
    tables: ParserTable[];
    refs?: ParserRef[];
  };

  const convertProjectToStructures = useCallback(
    (
      dbml: string,
    ): { tables: TableStructure[]; relationships: DBMLRelationship[] } => {
      const project = Parser.parse(dbml, "dbml");
      const schemas = project.schemas as unknown as ParserSchema[];
      const derivedTables: TableStructure[] = [];
      const relationships: DBMLRelationship[] = [];
      const foreignKeyMap = new Map<string, ForeignKeyInfo[]>();
      const databaseName =
        typeof project.name === "string" && project.name.length > 0
          ? project.name
          : targetDatabase;

      const getTableKey = (
        schemaName: string | null | undefined,
        tableName: string,
      ) => `${(schemaName ?? DEFAULT_SCHEMA).toLowerCase()}::${tableName}`;

      schemas.forEach((schemaEntry) => {
        const schemaName = schemaEntry.name ?? DEFAULT_SCHEMA;

        schemaEntry.tables.forEach((table) => {
          let columns: ColumnMeta[] = table.fields.map((field, index) => {
            let defaultValue: string | null = null;
            if (field.dbdefault && field.dbdefault.value != null) {
              const rawDefault = field.dbdefault.value;
              if (typeof rawDefault === "string") {
                defaultValue = rawDefault;
              } else if (
                typeof rawDefault === "number" ||
                typeof rawDefault === "boolean"
              ) {
                defaultValue = String(rawDefault);
              } else {
                defaultValue = JSON.stringify(rawDefault);
              }
            }

            return {
              name: field.name,
              db_type: field.type?.type_name ?? field.type?.name ?? "text",
              nullable: field.not_null !== true,
              default: defaultValue,
              is_pk: field.pk === true,
              is_fk: false,
              ordinal: index,
              precision: null,
              scale: null,
              comment:
                typeof field.note === "string"
                  ? field.note
                  : field.note?.text ?? null,
            } satisfies ColumnMeta;
          });

          // Extract primary keys from indexes if present
          let primaryKeys: string[] = [];

          // First check if columns are directly marked as PKs
          const directPks = columns
            .filter((column) => column.is_pk)
            .map((column) => column.name);

          if (directPks.length > 0) {
            primaryKeys = directPks;
          } else {
            // Check for indexes in the table object (DBML parser structure)
            const tableObj = table as any;

            // Try different possible locations for indexes in DBML AST
            // DBML parser stores indexes as an array on the table
            if (tableObj.indexes && Array.isArray(tableObj.indexes)) {
              // Look for index with pk setting
              for (const idx of tableObj.indexes) {
                // Check if this index has a pk property in its settings
                const hasPkSetting =
                  idx.settings &&
                  (idx.settings.pk === true ||
                    idx.settings.primary === true ||
                    idx.settings.primaryKey === true);

                // Check various ways DBML might mark primary keys
                const isPrimaryKey =
                  idx.pk === true ||
                  idx.primary === true ||
                  idx.type === "pk" ||
                  hasPkSetting ||
                  (idx.unique === true && idx.name?.includes("pkey"));

                if (isPrimaryKey) {
                  // Get column names from the index
                  if (idx.columns && Array.isArray(idx.columns)) {
                    primaryKeys = idx.columns.map((col: any) => {
                      // DBML parser stores column references as objects with 'value' property
                      if (typeof col === "object" && col.value) {
                        return col.value;
                      }
                      if (typeof col === "string") {
                        return col;
                      }
                      if (typeof col === "object" && col.name) {
                        return col.name;
                      }
                      if (typeof col === "object" && col.column) {
                        return col.column.name || col.column;
                      }
                      return col;
                    });
                    break;
                  }
                }
              }
            }

            // Also check if there's an indexes array at the schema level
            // that references this table
            const schemaIndexes = (schemaEntry as any).indexes;
            if (schemaIndexes && Array.isArray(schemaIndexes)) {
              const tablePkIndex = schemaIndexes.find(
                (idx: any) =>
                  idx.tableName === table.name &&
                  (idx.pk === true || idx.primary === true),
              );
              if (tablePkIndex && tablePkIndex.columns) {
                primaryKeys = tablePkIndex.columns.map((c: any) =>
                  typeof c === "string" ? c : c.name,
                );
              }
            }
          }

          // Mark columns as PKs if they're in the primaryKeys list
          if (primaryKeys.length > 0) {
            columns = columns.map((col) => ({
              ...col,
              is_pk: primaryKeys.includes(col.name),
            }));
          }

          const tableStructure: TableStructure = {
            name: table.name,
            schema: schemaName,
            database: databaseName,
            owner: undefined,
            comment:
              typeof table.note === "string" ? table.note : table.note?.text,
            rowCount: undefined,
            size: undefined,
            columns,
            primaryKeys,
            foreignKeys: [],
            indexes: [] as Index[],
            constraints: [] as Constraint[],
            triggers: [] as Trigger[],
            stats: undefined,
          };

          derivedTables.push(tableStructure);
          foreignKeyMap.set(getTableKey(schemaName, table.name), []);
        });

        (schemaEntry.refs ?? []).forEach((ref, index) => {
          if (!ref.endpoints || ref.endpoints.length < 2) return;

          const [endpointA, endpointB] = ref.endpoints;
          if (!endpointA || !endpointB) return;

          let source = endpointA;
          let target = endpointB;

          const relationWeight = (endpoint: ParserEndpoint): number => {
            const relation = (endpoint.relation ?? "").toLowerCase();
            if (relation.includes("*")) return 2;
            if (relation.includes("n")) return 2;
            if (relation.includes("many")) return 2;
            if (relation.includes("1")) return 1;
            return 1;
          };

          if (relationWeight(endpointB) > relationWeight(endpointA)) {
            source = endpointB;
            target = endpointA;
          }

          const sourceSchema = source.schemaName ?? schemaName;
          const targetSchema = target.schemaName ?? schemaName;

          const sourceCardinality = relationToCardinality(source.relation);
          const targetCardinality = relationToCardinality(target.relation);

          const fkName =
            typeof ref.name === "string" && ref.name.length > 0
              ? ref.name
              : `ref_${source.tableName}_${target.tableName}_${index + 1}`;

          const fk: ForeignKeyInfo = {
            name: fkName,
            columns: source.fieldNames,
            foreignTable: target.tableName,
            foreignSchema: targetSchema,
            foreignColumns: target.fieldNames,
            onDelete: ref.onDelete,
            onUpdate: ref.onUpdate,
          };

          const key = getTableKey(sourceSchema, source.tableName);
          const existing = foreignKeyMap.get(key) ?? [];
          foreignKeyMap.set(key, [...existing, fk]);

          relationships.push({
            id: `${sourceSchema}.${source.tableName}-${fkName}`,
            name: fkName,
            fromTable: source.tableName,
            fromSchema: sourceSchema,
            toTable: target.tableName,
            toSchema: targetSchema,
            fromColumns: source.fieldNames,
            toColumns: target.fieldNames,
            onDelete: ref.onDelete,
            onUpdate: ref.onUpdate,
            sourceCardinality,
            targetCardinality,
          });
        });
      });

      derivedTables.forEach((table) => {
        const key = `${table.schema.toLowerCase()}::${table.name}`;
        const foreignKeys = foreignKeyMap.get(key) ?? [];
        table.foreignKeys = foreignKeys;

        const fkColumnNames = new Set(
          foreignKeys.flatMap((fk) =>
            fk.columns.map((column) => column.toLowerCase()),
          ),
        );
        table.columns = table.columns.map((column, idx) => ({
          ...column,
          ordinal: idx,
          is_fk: fkColumnNames.has(column.name.toLowerCase()),
        }));

        // Backfill constraint info for primary keys for parity with TableStructure
        if (table.primaryKeys.length > 0) {
          table.constraints.push({
            name: `${table.name}_pkey`,
            table_name: table.name,
            constraint_type: ConstraintType.PrimaryKey,
            definition: `PRIMARY KEY (${table.primaryKeys.join(", ")})`,
            foreign_table: undefined,
          });
        }
      });

      return { tables: derivedTables, relationships };
    },
    [targetDatabase],
  );

  useEffect(() => {
    if (skipParseNextRef.current) {
      skipParseNextRef.current = false;
      return;
    }

    if (!dbmlDocument.trim()) {
      setParseError(null);
      return;
    }

    window.clearTimeout(parseTimerRef.current);
    parseTimerRef.current = window.setTimeout(() => {
      const worker = dbmlWorkerRef.current;
      if (!worker) {
        setParseError("Parser worker not initialized");
        return;
      }

      // Set up one-time message handler for this parse operation
      const handleWorkerMessage = (e: MessageEvent) => {
        const output = e.data as {
          success: boolean;
          result?: { tables: TableStructure[]; relationships: DBMLRelationship[] };
          error?: string;
        };

        worker.removeEventListener("message", handleWorkerMessage);

        if (output.success && output.result) {
          const { tables: parsedTables, relationships: parsedRelationships } = output.result;

          // Always update tables and relationships - viewport preservation is handled in ERDVisualizer
          setTables(parsedTables);
          setRelationships(parsedRelationships);
          setParseError(null);
          
          if (localViewId) {
            updateView(localViewId, {
              dbml: dbmlDocument,
              tableCount: parsedTables.length,
              relationshipCount: parsedRelationships.length,
            });
            erdCache.set(connectionId, targetDatabase, selectedSchema, {
              dbml: dbmlDocument,
              ast: null,
              metadata: {
                tableCount: parsedTables.length,
                relationshipCount: parsedRelationships.length,
                enumCount: 0,
                version: "1.0",
                generatedAt: new Date(),
              },
              relationships: parsedRelationships,
              tables: parsedTables,
            });
          }
        } else {
          setParseError(output.error ?? "Unable to parse DBML document");
        }
      };

      worker.addEventListener("message", handleWorkerMessage);
      worker.postMessage({ dbml: dbmlDocument, targetDatabase });
    }, PARSE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(parseTimerRef.current);
    };
  }, [
    dbmlDocument,
    localViewId,
    convertProjectToStructures,
    updateView,
    connectionId,
    targetDatabase,
    selectedSchema,
  ]);

  const handleEditorChange = useCallback(
    (value: string) => {
      setDbmlDocument(value);
      if (localViewId) {
        updateView(localViewId, { dbml: value });
      }
    },
    [localViewId, updateView],
  );

  // Memoize CodeEditor to prevent unnecessary re-renders
  const memoizedCodeEditor = useMemo(
    () => (
      <CodeEditor
        ref={editorRef}
        value={dbmlDocument}
        onChange={handleEditorChange}
        language="dbml"
        readOnly={false}
        className="h-full"
        placeholder={loading ? "Loading schema..." : "Edit DBML to update the diagram"}
        // Performance: disable heavy extensions for smoother scrolling
        lineNumbers={true}
      />
    ),
    [dbmlDocument, handleEditorChange, loading],
  );

  const handleColumnDoubleClick = useCallback(
    (tableName: string, columnName: string) => {
      // Ensure the code editor is visible before searching
      if (!isCodeVisible) {
        setIsCodeVisible(true);
      }

      // Wait for the editor to render, then search for the column
      setTimeout(() => {
        // Find the column definition in the DBML document
        // Pattern: "Table tableName" followed by column definition
        const lines = dbmlDocument.split("\n");
        let tableStartIndex = -1;
        let columnLineIndex = -1;

        // Find the table definition
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          // Match "Table tableName" or "Table schema.tableName"
          const tableMatch = line.match(
            /^\s*Table\s+(?:\w+\.)?(\w+)\s*\{?\s*$/i,
          );
          if (tableMatch && tableMatch[1] === tableName) {
            tableStartIndex = i;
            break;
          }
        }

        // Find the column within the table
        if (tableStartIndex !== -1) {
          for (let i = tableStartIndex + 1; i < lines.length; i++) {
            const line = lines[i] ?? "";
            // Break if we hit another table or closing brace
            if (line.match(/^\s*Table\s+/i) || line.match(/^\s*\}\s*$/)) {
              break;
            }
            // Match column definition (columnName type [options])
            const columnMatch = line.match(/^\s*(\w+)\s+/);
            if (columnMatch && columnMatch[1] === columnName) {
              columnLineIndex = i;
              break;
            }
          }
        }

        // If we found the column, reveal and focus on that line
        if (columnLineIndex !== -1) {
          // Line numbers are 1-based for revealLine
          editorRef.current?.revealLine(columnLineIndex + 1);
        }
      }, 100);
    },
    [isCodeVisible, dbmlDocument],
  );

  return (
    <div
      className="relative flex h-full flex-col"
      data-panel-id={tabId}
      data-connection-id={connectionId}
    >
      {parseError ? (
        <div className="border-l-4 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive select-text">
          {parseError}
        </div>
      ) : null}

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Code Editor Panel - LEFT side */}
        {isCodeVisible && (
          <ResizablePanel
            defaultSize={40}
            minSize={20}
            maxSize={70}
            order={1}
            collapsible={true}
            collapsedSize={0}
            onCollapse={() => {
              setIsCodeVisible(false);
            }}
            className="border-r bg-background"
            style={{
              // GPU acceleration for smooth resizing and scrolling
              transform: 'translateZ(0)',
              willChange: 'width',
              backfaceVisibility: 'hidden',
            }}
          >
            {memoizedCodeEditor}
          </ResizablePanel>
        )}
        {isCodeVisible && <ResizableHandle />}

        {/* Visual Diagram Panel - RIGHT side or full width */}
        <ResizablePanel
          defaultSize={isCodeVisible ? 60 : 100}
          minSize={30}
          order={2}
          className="relative"
          style={{
            // GPU acceleration for smooth rendering
            transform: 'translateZ(0)',
            willChange: 'width',
            backfaceVisibility: 'hidden',
          }}
        >
          {/* Always render ReactFlowProvider to preserve viewport state */}
          <ReactFlowProvider>
            {/* Toolbar - only show when we have tables */}
            {tables.length > 0 && !loading && !error && (
              <div className="absolute top-0 left-0 right-0 bg-transparent z-10">
                <ERDToolbar
                  isCodeVisible={isCodeVisible}
                  onToggleCodePanel={() => {
                    setIsCodeVisible((prev) => !prev);
                  }}
                  onCreateView={() => {
                    // TODO: hook into ERD view creation when multi-view support is added
                  }}
                  onRefresh={handleRefresh}
                  onAutoArrange={() => {
                    erdVisualizerRef.current?.triggerAutoArrange();
                  }}
                  onZoomIn={() => {
                    erdVisualizerRef.current?.zoomIn();
                  }}
                  onZoomOut={() => {
                    erdVisualizerRef.current?.zoomOut();
                  }}
                  onFitView={() => {
                    erdVisualizerRef.current?.fitView();
                  }}
                  layoutDirection={layoutDirection}
                  onLayoutDirectionChange={(direction) => {
                    setLayoutDirection(direction);
                    if (localViewId) {
                      updateView(localViewId, { layoutDirection: direction });
                    }
                  }}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onExportPNG={() => { void handleExportImage("png"); }}
                  onExportSVG={() => { void handleExportImage("svg"); }}
                  onExportSQL={(fmt) => { void handleExportSQL(fmt); }}
                  isExporting={isExporting}
                />
              </div>
            )}

            {/* ERDVisualizer - always mounted to preserve state, hidden when no data */}
            <div
              ref={diagramContainerRef}
              className={tables.length > 0 && !loading && !error ? "h-full w-full" : "hidden"}
            >
              <ERDVisualizer
                ref={erdVisualizerRef}
                tables={tables}
                relationships={relationships}
                nodePositions={localView?.nodePositions ?? {}}
                initialViewport={localView?.viewport}
                layoutDirection={layoutDirection}
                hasManualPositions={localView?.hasManualPositions ?? false}
                onNodePositionsChange={handleNodePositionsChange}
                onNodePositionChange={handleNodePositionChange}
                onViewportChange={handleViewportChange}
                searchQuery={searchQuery}
                onColumnDoubleClick={handleColumnDoubleClick}
                onLayoutDirectionChange={(direction) => {
                  setLayoutDirection(direction);
                  if (localViewId) {
                    updateView(localViewId, { layoutDirection: direction });
                  }
                }}
              />
            </div>

            {/* Placeholder - shown when loading or error or no tables */}
            {(loading || error || tables.length === 0) && (
              <ERDVisualizerPlaceholder
                loading={loading}
                error={error}
                tableCount={tables.length}
                relationshipCount={relationships.length}
                schema={selectedSchema}
              />
            )}
          </ReactFlowProvider>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
