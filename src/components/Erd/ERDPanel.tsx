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
import { exporter as dbmlExporter } from "@dbml/core";
import { toPng, toSvg } from "html-to-image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeBinaryFile } from "@/utils/tauriFs";
import { isTauri } from "@/utils/tauri";
import { toast } from "sonner";

import {
  dbmlService,
  type DBMLSchema,
  type DBMLRelationship,
} from "@/services/dbmlService";
import { databaseService } from "@/services/databaseService";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type { TableStructure } from "@/types/tableStructure";
import { erdCache } from "@/services/erdCache";
import {
  useErdStore,
  type NodePosition,
  type ViewportState,
} from "@/stores/erdStore";
import { ERDSchemaLegend } from "./ERDSchemaLegend";

const DEFAULT_SCHEMA = "public";
const PARSE_DEBOUNCE_MS = 500;

interface ERDPanelProps {
  connectionId: string;
  tabId: string;
  database?: string;
  /**
   * Phase 5: ordered list of schemas to render. Primary (for initial
   * centering) is `schemas[0]`. When omitted, falls back to single-schema
   * `schema` prop for back-compat; empty array yields the empty state.
   */
  schemas?: string[];
  /** Legacy single-schema prop, retained for callers still on Phase 4. */
  schema?: string;
}

export const ERDPanel: React.FC<ERDPanelProps> = ({
  connectionId,
  tabId,
  database,
  schema,
  schemas: schemasProp,
}) => {
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const [dbmlDocument, setDbmlDocument] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<DBMLRelationship[]>([]);
  const [tables, setTables] = useState<TableStructure[]>([]);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("TB");
  const [allSchemas, setAllSchemas] = useState<string[]>([]);

  // Resolve initial schemas from prop or legacy schema field
  const initialSchemas = React.useMemo(() => {
    if (schemasProp && schemasProp.length > 0) return schemasProp.slice();
    if (schema) return [schema];
    return [];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedSchemas, setSelectedSchemasState] = useState<string[]>(initialSchemas);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const lastConnectionRef = useRef<string | null>(connectionId);
  const skipParseNextRef = useRef<boolean>(false);
  const parseTimerRef = useRef<number | undefined>(undefined);
  const erdVisualizerRef = useRef<ERDVisualizerRef | null>(null);
  const editorRef = useRef<CodeEditorRef>(null);
  const dbmlWorkerRef = useRef<Worker | null>(null);
  const diagramContainerRef = useRef<HTMLDivElement>(null);
  // Monotonic generation counters used to drop stale results when the user
  // changes selection or types another character before the previous request
  // completes. See fixes for the worker race + loadSchemasData cancellation.
  const loadGenRef = useRef(0);
  const parseGenRef = useRef(0);

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
  const setViewSchemas = useErdStore((state) => state.setViewSchemas);

  // Sync selectedSchemas from store (e.g. restored from persistence)
  const viewSchemasFromStore = useErdStore(
    (s) => (localViewId ? s.views[localViewId]?.selectedSchemas : undefined),
  );
  useEffect(() => {
    if (viewSchemasFromStore && viewSchemasFromStore.length > 0) {
      setSelectedSchemasState(viewSchemasFromStore);
    }
  }, [viewSchemasFromStore]);

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
      const previousConnectionId = lastConnectionRef.current;
      lastConnectionRef.current = connectionId;
      // Drop any cached DBML for the *outgoing* connection. Connection IDs
      // can be recycled (delete + recreate, profile re-save) and we don't
      // want a stale entry served to the next user of that ID.
      if (previousConnectionId) {
        erdCache.clear(previousConnectionId);
      }
      const resetSchemas = schemasProp?.length ? schemasProp.slice() : schema ? [schema] : [];
      setSelectedSchemasState(resetSchemas);
      skipParseNextRef.current = true;
      setDbmlDocument("");
      setParseError(null);
      setError(null);
      setTables([]);
      setRelationships([]);
    }
  }, [connectionId, schema, schemasProp]);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      if (!connectionId || !targetDatabase) return;
      try {
        const result = await databaseService.listSchemas(connectionId, targetDatabase);
        if (cancelled) return;
        setAllSchemas(result);
      } catch (err) {
        logger.error("Failed to load schemas for ERD", err);
      }
    };
    void fetchAll();
    return () => { cancelled = true; };
  }, [connectionId, targetDatabase]);

  const loadSchemasData = useCallback(
    async (schemaList: string[], options?: { force?: boolean }) => {
      if (!connectionId) return;
      // Bump generation; any in-flight previous load becomes stale and will
      // bail out at the next await checkpoint.
      const myGen = ++loadGenRef.current;
      const isStale = () => myGen !== loadGenRef.current;

      if (schemaList.length === 0) {
        setTables([]);
        setRelationships([]);
        setDbmlDocument("// Pick schemas to render");
        return;
      }

      const viewId = ensureView({
        connectionId,
        database: targetDatabase,
        schema: schemaList[0] ?? DEFAULT_SCHEMA,
        // Pass the full list — without it, a single-schema view for "public"
        // and a multi-schema view for ["public", "billing"] would collide on
        // the primary schema and share node positions / viewport.
        schemas: schemaList,
        name: `${schemaList.join(", ")} @ ${targetDatabase}`,
      });
      setLocalViewId(viewId);

      const cacheHit = options?.force
        ? null
        : erdCache.getSchemas(connectionId, targetDatabase, schemaList);

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
        // 1. List tables across all schemas in parallel.
        const perSchema = await Promise.all(
          schemaList.map((s) => databaseService.listTables(connectionId, targetDatabase, s)),
        );
        if (isStale()) return;
        const baseTables = perSchema
          .flat()
          .filter((t) => t.kind === "Table" && !t.isPartitioned);

        if (baseTables.length === 0) {
          const empty: DBMLSchema = {
            dbml: "// No tables found",
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
          setDbmlDocument(empty.dbml);
          setTables([]);
          setRelationships([]);
          setError(null);
          updateView(viewId, {
            dbml: empty.dbml,
            tableCount: 0,
            relationshipCount: 0,
          });
          erdCache.setSchemas(connectionId, targetDatabase, schemaList, empty);
          return;
        }

        // 2. Fetch table structures with GLOBAL concurrency cap of 5
        //    (not per-schema — that would fan out N*5 requests).
        const collected: TableStructure[] = [];
        await batchWithConcurrency(
          baseTables,
          async (table) => {
            const struct = await databaseService.getTableStructure(
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
            );
            collected.push(struct);
            // Progressive render: append as each arrives — but only if we're
            // still the current load. Otherwise this would pollute a newer
            // selection's table list.
            if (!isStale()) {
              setTables((prev) => [...prev, struct]);
            }
            return struct;
          },
          5,
        );
        if (isStale()) return;

        const result = await dbmlService.schemaToDBML(collected, {
          databaseType: connection?.db_type,
        });
        if (isStale()) return;

        skipParseNextRef.current = true;
        setDbmlDocument(result.dbml);
        setTables(result.tables);
        setRelationships(result.relationships);
        setError(null);
        erdCache.setSchemas(connectionId, targetDatabase, schemaList, result);
        updateView(viewId, {
          dbml: result.dbml,
          tableCount: result.metadata.tableCount,
          relationshipCount: result.metadata.relationshipCount,
        });
      } catch (err) {
        if (isStale()) return;
        logger.error("Failed to load ERD schemas", err);
        setError(err instanceof Error ? err.message : "Failed to load schema metadata.");
        setTables([]);
        setRelationships([]);
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [connectionId, targetDatabase, ensureView, connection?.db_type, updateView],
  );

  useEffect(() => {
    if (!connectionId) return;
    void loadSchemasData(selectedSchemas);
  }, [connectionId, selectedSchemas, loadSchemasData]);

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
    void loadSchemasData(selectedSchemas, { force: true });
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
      const baseWidth = Math.ceil(nodesBounds.width + PADDING * 2);
      const baseHeight = Math.ceil(nodesBounds.height + PADDING * 2);

      // Browsers cap canvas size — Safari at 4096 × 4096 by default,
      // Chrome around 16,384 × 16,384. With pixelRatio 2 the effective
      // pixel count doubles, so we clamp pixelRatio so width × pixelRatio
      // and height × pixelRatio stay below a portable safe ceiling. PNG
      // exports also fall back to 1:1 when even pixelRatio 1 would exceed
      // the limit, and we surface a clearer error to the user.
      const SAFE_MAX_DIMENSION = 8192;
      const largestSide = Math.max(baseWidth, baseHeight);
      const maxRatio =
        largestSide > 0
          ? Math.max(1, Math.floor(SAFE_MAX_DIMENSION / largestSide))
          : 2;
      const pixelRatio = format === "png" ? Math.min(2, maxRatio) : 1;

      if (format === "png" && largestSide > SAFE_MAX_DIMENSION) {
        toast.error(
          `Diagram is too large to export as PNG (${baseWidth}×${baseHeight}px). Try SVG or zoom out.`,
        );
        return;
      }

      const imageWidth = baseWidth;
      const imageHeight = baseHeight;
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
        pixelRatio,
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

      const filename = `erd-${selectedSchemas[0] ?? "erd"}.${format}`;

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
          await writeBinaryFile(filePath, new Uint8Array(arrayBuffer));
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
  }, [selectedSchemas]);

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
          defaultPath: `erd-${selectedSchemas[0] ?? "erd"}.sql`,
          filters: [
            { name: "SQL Files", extensions: ["sql"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (filePath) {
          await writeTextFile(filePath, sql);
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
  }, [dbmlDocument, selectedSchemas]);

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

  // Note: a previous version of this file kept a duplicate copy of the DBML
  // → TableStructure conversion here. The worker (`dbmlParser.worker.ts`)
  // owns the canonical implementation, so the in-component copy was dead
  // code (~260 lines) and has been removed.

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

      // Bump the parse generation; any in-flight prior parse becomes stale.
      // We use single-slot `worker.onmessage` (replaces the prior handler in
      // the same DOM slot) to guarantee at most one handler is attached at a
      // time. The captured `myGen` lets a late message from a previous parse
      // bail out before it overwrites the cache with a stale `dbmlDocument`.
      const myGen = ++parseGenRef.current;
      const sourceDbml = dbmlDocument;

      worker.onmessage = (e: MessageEvent) => {
        if (myGen !== parseGenRef.current) return; // superseded by a newer parse
        const output = e.data as {
          success: boolean;
          result?: { tables: TableStructure[]; relationships: DBMLRelationship[] };
          error?: string;
        };

        if (output.success && output.result) {
          const { tables: parsedTables, relationships: parsedRelationships } = output.result;

          // Always update tables and relationships - viewport preservation is handled in ERDVisualizer
          setTables(parsedTables);
          setRelationships(parsedRelationships);
          setParseError(null);

          if (localViewId) {
            updateView(localViewId, {
              dbml: sourceDbml,
              tableCount: parsedTables.length,
              relationshipCount: parsedRelationships.length,
            });
            erdCache.setSchemas(connectionId, targetDatabase, selectedSchemas, {
              dbml: sourceDbml,
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

      worker.postMessage({ dbml: sourceDbml, targetDatabase });
    }, PARSE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(parseTimerRef.current);
    };
  }, [
    dbmlDocument,
    localViewId,
    updateView,
    connectionId,
    targetDatabase,
    selectedSchemas,
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

        // DBML identifiers can be bare (\w+), double-quoted, single-quoted,
        // or backtick-quoted. The previous \w+-only regex silently failed on
        // schema/table names containing hyphens, dots, etc.
        const IDENT = `(?:"[^"]+"|'[^']+'|\`[^\`]+\`|\\w+)`;
        const tableLineRe = new RegExp(
          `^\\s*Table\\s+(?:${IDENT}\\.)?(${IDENT})(?:\\s+as\\s+${IDENT})?\\s*\\{?\\s*$`,
          "i",
        );
        const columnLineRe = new RegExp(`^\\s*(${IDENT})\\s+`);
        const unquote = (id: string): string => {
          if (id.length >= 2) {
            const first = id[0];
            const last = id[id.length - 1];
            if (
              (first === '"' && last === '"') ||
              (first === "'" && last === "'") ||
              (first === "`" && last === "`")
            ) {
              return id.slice(1, -1);
            }
          }
          return id;
        };

        // Find the table definition
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          const tableMatch = line.match(tableLineRe);
          if (tableMatch && unquote(tableMatch[1] ?? "") === tableName) {
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
            const columnMatch = line.match(columnLineRe);
            if (columnMatch && unquote(columnMatch[1] ?? "") === columnName) {
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

  const tableCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const t of tables) acc[t.schema] = (acc[t.schema] ?? 0) + 1;
    return acc;
  }, [tables]);

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
      {selectedSchemas.length > 1 && !loading && !error && tables.length > 0 && (
        <ERDSchemaLegend schemas={selectedSchemas} tableCounts={tableCounts} />
      )}

      <ResizablePanelGroup orientation="horizontal" className="flex-1" autoSaveId="erd-panel-split">
        {/* Code Editor Panel - LEFT side */}
        {isCodeVisible && (
          <ResizablePanel
            id="erd-code"
            defaultSize="40"
            minSize="20"
            maxSize="70"
            collapsible={true}
            collapsedSize="0"
            onResize={(size) => {
              if (size.asPercentage <= 0.1) setIsCodeVisible(false);
            }}
            className="border-r bg-background"
            style={{
              // GPU acceleration for smooth scrolling
              transform: 'translateZ(0)',
              backfaceVisibility: 'hidden',
            }}
          >
            {memoizedCodeEditor}
          </ResizablePanel>
        )}
        {isCodeVisible && <ResizableHandle />}

        {/* Visual Diagram Panel - RIGHT side or full width */}
        <ResizablePanel
          id="erd-diagram"
          defaultSize={isCodeVisible ? "60" : "100"}
          minSize="30"
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
                  selectedSchemas={selectedSchemas}
                  allSchemas={allSchemas}
                  onSchemasChange={(next) => {
                    setSelectedSchemasState(next);
                    if (localViewId) setViewSchemas(localViewId, next);
                  }}
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
                schema={selectedSchemas[0] ?? DEFAULT_SCHEMA}
              />
            )}
          </ReactFlowProvider>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
