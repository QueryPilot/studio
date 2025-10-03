import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { CodeEditor } from "@/components/CodeEditor";
import { ERDToolbar } from "./ERDToolbar";
import { ERDVisualizerPlaceholder } from "./ERDVisualizerPlaceholder";
import { ERDVisualizer } from "./ERDVisualizer";
import { ReactFlowProvider } from "reactflow";
import { Parser } from "@dbml/core";

import {
  dbmlService,
  type DBMLSchema,
  type DBMLRelationship,
} from "@/services/dbmlService";
import { databaseService } from "@/services/databaseService";
import { useConnectionStore } from "@/stores/connectionStore";
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
} from "@/services/backend";

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
  const [mode, setMode] = useState<"visual" | "code" | "split">("visual");
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [dbmlDocument, setDbmlDocument] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<DBMLRelationship[]>([]);
  const [tables, setTables] = useState<TableStructure[]>([]);
  const [schemas, setSchemas] = useState<string[]>(() =>
    schema ? [schema] : [DEFAULT_SCHEMA],
  );
  const [selectedSchema, setSelectedSchema] = useState<string>(
    schema ?? DEFAULT_SCHEMA,
  );
  const lastConnectionRef = useRef<string | null>(connectionId);
  const skipParseNextRef = useRef<boolean>(false);
  const parseTimerRef = useRef<number | undefined>(undefined);
  const erdVisualizerRef = useRef<{ triggerAutoArrange: () => void } | null>(
    null,
  );

  const ensureView = useErdStore((state) => state.ensureView);
  const setActiveViewStore = useErdStore((state) => state.setActiveView);
  const activeViewId = useErdStore((state) => state.activeViewId);
  const activeView = useErdStore((state) =>
    state.activeViewId ? state.views[state.activeViewId] ?? null : null,
  );
  const updateView = useErdStore((state) => state.updateView);
  const saveNodePosition = useErdStore((state) => state.saveNodePosition);
  const saveViewport = useErdStore((state) => state.saveViewport);

  const connection = useConnectionStore(
    (state) =>
      state.connections.find((item) => item.id === connectionId) || null,
  );

  const targetDatabase = database ?? connection?.database ?? "";

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
        console.error("Failed to load schemas for ERD", err);
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
      setActiveViewStore(viewId);

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

        const baseTables = tableMetas.filter((table) => table.kind === "Table");

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

        const structures = await Promise.all(
          baseTables.map((table) =>
            databaseService.getTableStructure(
              connectionId,
              targetDatabase,
              table.schema,
              table.name,
              {
                includeIndexes: true,
                includeConstraints: true,
                includeForeignKeys: true,
              },
            ),
          ),
        );

        const result = await dbmlService.schemaToDBML(structures, {
          databaseType: connection?.type,
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
        console.error("Failed to load ERD schema", err);
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
      setActiveViewStore,
      connection?.type,
      updateView,
    ],
  );

  useEffect(() => {
    if (!connectionId || !selectedSchema) return;
    void loadSchemaData(selectedSchema);
  }, [connectionId, selectedSchema, loadSchemaData]);

  useEffect(() => {
    if (
      activeView?.dbml &&
      !skipParseNextRef.current &&
      activeView.dbml !== dbmlDocument
    ) {
      setDbmlDocument(activeView.dbml);
    }
  }, [activeView?.dbml, dbmlDocument]);

  const handleSchemaChange = (next: string) => {
    setSelectedSchema(next);
    setTables([]);
    setRelationships([]);
    setError(null);
    setParseError(null);
  };

  const handleRefresh = () => {
    void loadSchemaData(selectedSchema, { force: true });
  };

  const handleNodePositionsChange = useCallback(
    (positions: Record<string, NodePosition>) => {
      if (!activeViewId) return;
      updateView(activeViewId, { nodePositions: positions });
    },
    [activeViewId, updateView],
  );

  const handleNodePositionChange = useCallback(
    (nodeId: string, position: NodePosition) => {
      if (!activeViewId) return;
      saveNodePosition(activeViewId, nodeId, position);
    },
    [activeViewId, saveNodePosition],
  );

  const handleViewportChange = useCallback(
    (viewport: ViewportState) => {
      if (!activeViewId) return;
      saveViewport(activeViewId, viewport);
    },
    [activeViewId, saveViewport],
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
      try {
        const parsed = convertProjectToStructures(dbmlDocument);
        setTables(parsed.tables);
        setRelationships(parsed.relationships);
        setParseError(null);
        if (activeViewId) {
          updateView(activeViewId, {
            dbml: dbmlDocument,
            tableCount: parsed.tables.length,
            relationshipCount: parsed.relationships.length,
          });
          erdCache.set(connectionId, targetDatabase, selectedSchema, {
            dbml: dbmlDocument,
            ast: null,
            metadata: {
              tableCount: parsed.tables.length,
              relationshipCount: parsed.relationships.length,
              enumCount: 0,
              version: "1.0",
              generatedAt: new Date(),
            },
            relationships: parsed.relationships,
            tables: parsed.tables,
          });
        }
      } catch (err) {
        if (err instanceof Error) {
          setParseError(err.message);
        } else {
          setParseError("Unable to parse DBML document");
        }
      }
    }, PARSE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(parseTimerRef.current);
    };
  }, [
    dbmlDocument,
    activeViewId,
    convertProjectToStructures,
    updateView,
    connectionId,
    targetDatabase,
    selectedSchema,
  ]);

  const handleEditorChange = useCallback(
    (value: string) => {
      setDbmlDocument(value);
      if (activeViewId) {
        updateView(activeViewId, { dbml: value });
      }
    },
    [activeViewId, updateView],
  );

  return (
    <div
      className="relative flex h-full flex-col"
      data-panel-id={tabId}
      data-connection-id={connectionId}
    >
      <div className="absolute top-0 left-0 right-0 bg-transparent z-10">
        <ERDToolbar
          mode={mode}
          onModeChange={(next) => {
            setMode(next);
            if (next !== "split") {
              setEditorCollapsed(false);
            }
          }}
          onCreateView={() => {
            // TODO: hook into ERD view creation when multi-view support is added
          }}
          onRefresh={handleRefresh}
          onAutoArrange={() => {
            erdVisualizerRef.current?.triggerAutoArrange();
          }}
        />
      </div>

      {parseError ? (
        <div className="border-l-4 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive select-text">
          {parseError}
        </div>
      ) : null}

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel
          defaultSize={mode === "split" ? 60 : 100}
          minSize={30}
          className="border-r"
          style={{
            display: mode === "code" ? "none" : "block",
          }}
        >
          {tables.length > 0 && !loading && !error ? (
            <ReactFlowProvider>
              <ERDVisualizer
                ref={erdVisualizerRef}
                tables={tables}
                relationships={relationships}
                nodePositions={activeView?.nodePositions ?? {}}
                initialViewport={activeView?.viewport}
                onNodePositionsChange={handleNodePositionsChange}
                onNodePositionChange={handleNodePositionChange}
                onViewportChange={handleViewportChange}
              />
            </ReactFlowProvider>
          ) : (
            <ERDVisualizerPlaceholder
              loading={loading}
              error={error}
              tableCount={tables.length}
              relationshipCount={relationships.length}
              schema={selectedSchema}
            />
          )}
        </ResizablePanel>
        {mode === "split" && !editorCollapsed && <ResizableHandle />}
        {(mode === "code" || mode === "split") && (
          <ResizablePanel
            defaultSize={mode === "code" ? 100 : 40}
            minSize={20}
            maxSize={mode === "code" ? 100 : 70}
            collapsible={mode === "split"}
            onCollapse={() => {
              setEditorCollapsed(true);
            }}
            onExpand={() => {
              setEditorCollapsed(false);
            }}
            className="border-l bg-background"
            style={{
              display: editorCollapsed ? "none" : "block",
            }}
          >
            <CodeEditor
              value={dbmlDocument}
              onChange={handleEditorChange}
              language="dbml"
              readOnly={false}
              className="h-full"
              placeholder={
                loading
                  ? "Loading schema..."
                  : "Edit DBML to update the diagram"
              }
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
};
