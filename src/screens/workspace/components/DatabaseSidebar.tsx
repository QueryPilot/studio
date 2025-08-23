import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  Table,
  Eye,
  Code,
  Search,
  Loader2,
  RefreshCw,
  Database,
  Layers,
  Zap,
  Bolt,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useConnectionStore } from "@/stores";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useParams } from "react-router-dom";
import { secureDatabaseService } from "@/services/secureDatabaseService";
import { cacheService } from "@/services/cacheService";
import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/database";

interface TreeItem {
  name: string;
  type: "table" | "view" | "function";
  children?: TreeItem[];
}

export function DatabaseSidebar() {
  const [expanded, setExpanded] = useState<string[]>(["Tables"]);

  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [functions, setFunctions] = useState<FunctionInfo[]>([]);

  const { id: workspaceId } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore((state) =>
    state.getWorkspace(workspaceId || ""),
  );
  const {
    addTab,
    updateTabPayload,
    setActiveTab,
    setActiveConnection: setWorkspaceActiveConnection,
    addConnectionToWorkspace,
  } = useWorkspaceStore();
  const tabs = workspace ? Array.from(workspace.tabs.values()) : [];
  const activeTabId = workspace?.activeTabId || "";

  const { connections, connect, setActiveConnection, activeConnectionId } =
    useConnectionStore();
  const {
    selectedSchema,
    setSelectedSchema,
    availableSchemas,
    setAvailableSchemas,
  } = useUIStore();

  // Use workspace-scoped active connection for UI consistency
  const workspaceActiveConnectionId = workspace?.activeConnectionId;
  const activeConnection = workspaceActiveConnectionId
    ? connections.get(workspaceActiveConnectionId)
    : null;

  const workspaceConnections = Array.from(connections.values());

  const toggleExpand = (name: string) => {
    setExpanded((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  };

  const handleConnectionChange = async (connectionId: string) => {
    // Navigate to workspace and switch database connection
    if (workspaceId && workspaceActiveConnectionId !== connectionId) {
      // Ensure connection is added to workspace FIRST
      addConnectionToWorkspace(workspaceId, connectionId);

      // Then set the workspace-scoped active connection
      // This will automatically save current tabs and restore previous tabs
      setWorkspaceActiveConnection(workspaceId, connectionId);
    }

    // Set the global connection as active for backend operations
    setActiveConnection(connectionId);

    // Get the selected connection
    const selectedConnection = connections.get(connectionId);

    // If the connection is not connected, initiate connection
    if (
      selectedConnection &&
      selectedConnection.status !== "connected" &&
      selectedConnection.status !== "connecting"
    ) {
      console.log(
        `[DatabaseSidebar] Initiating connection for ${connectionId} on selection`,
      );
      try {
        await connect(connectionId, 3, workspaceId);
      } catch (error) {
        console.error(`[DatabaseSidebar] Failed to connect:`, error);
      }
    }
  };

  const connectionStatus = activeConnection?.status || "disconnected";

  const loadDatabaseSchema = async (forceResetSchema = false) => {
    console.log(
      "[DatabaseSidebar] loadDatabaseSchema called, checking conditions:",
      {
        hasActiveConnection: !!activeConnection,
        status: activeConnection?.status,
        activeConnectionId,
        forceResetSchema,
        isLoadingSchema,
      },
    );

    // Check connection status first before setting loading state
    if (
      !activeConnection ||
      activeConnection.status !== "connected" ||
      !activeConnectionId
    ) {
      console.log(
        "[DatabaseSidebar] Skipping schema load - conditions not met",
      );
      return;
    }

    // Prevent concurrent schema loads to avoid race conditions
    if (isLoadingSchema) {
      console.log(
        "[DatabaseSidebar] Schema already loading, skipping concurrent request",
      );
      return;
    }

    console.log(
      "[DatabaseSidebar] Starting to load schema for:",
      activeConnectionId,
    );
    setIsLoadingSchema(true);
    try {
      let tablesData: TableInfo[];
      let viewsData: ViewInfo[];
      let functionsData: FunctionInfo[];
      // TODO: Add trigger support when backend implements getTriggers
      // let triggersData: TriggerInfo[];

      // Check cache first unless force refresh
      if (!forceResetSchema) {
        const cachedSchema = await cacheService.getSchema(activeConnectionId);
        if (cachedSchema) {
          console.log("[DatabaseSidebar] Using cached schema data");
          tablesData = cachedSchema.tables;
          viewsData = cachedSchema.views;
          functionsData = cachedSchema.functions;
        } else {
          console.log("[DatabaseSidebar] Cache miss, fetching fresh schema");

          // Determine database name based on connection type
          const databaseName = 
            (activeConnection?.config.type === 'mysql' || activeConnection?.config.type === 'mariadb')
              ? activeConnection.config.database || ''
              : '';
          
          let tables: TableInfo[];
          let views: ViewInfo[];
          let functions: FunctionInfo[];
          
          // Handle different database types
          const dbType = activeConnection?.config.type;
          
          if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'sqlite') {
            // For MySQL/MariaDB/SQLite: fetch directly without schema iteration
            console.log(`[DatabaseSidebar] Fetching data for ${dbType} (no schema iteration)`);
            console.log(`[DatabaseSidebar] Database name: '${databaseName}', Connection ID: '${activeConnectionId}'`);
            console.log(`[DatabaseSidebar] Connection config:`, activeConnection?.config);
            
            // For SQLite, use empty strings. For MySQL/MariaDB, pass the database name only for database param
            const dbParam = dbType === 'sqlite' ? '' : (databaseName || activeConnection?.config.database || '');
            const schemaParam = ''; // Don't pass schema for any of these databases
            
            console.log(`[DatabaseSidebar] Using database: '${dbParam}', schema: '${schemaParam}'`);
            
            try {
              // Try different parameter combinations to find what works
              let tablesData: TableInfo[] = [];
              let viewsData: ViewInfo[] = [];
              let functionsData: FunctionInfo[] = [];
              
              // First attempt: with database and schema parameters
              console.log(`[DatabaseSidebar] Attempt 1: Fetching with database='${dbParam}', schema='${schemaParam}'`);
              
              [tablesData, viewsData, functionsData] = await Promise.all([
                secureDatabaseService
                  .getTables(activeConnectionId, dbParam, schemaParam)
                  .then((result) => {
                    console.log(`[DatabaseSidebar] Tables fetched (attempt 1):`, result);
                    return result;
                  }),
                secureDatabaseService
                  .getViews(activeConnectionId, dbParam, schemaParam)
                  .then((result) => {
                    console.log(`[DatabaseSidebar] Views fetched (attempt 1):`, result);
                    return result;
                  }),
                secureDatabaseService
                  .getFunctions(activeConnectionId, dbParam, schemaParam)
                  .then((result) => {
                    console.log(`[DatabaseSidebar] Functions fetched (attempt 1):`, result);
                    return result;
                  }),
              ]);
              
              // If no tables found and it's MySQL/MariaDB, try with empty database parameter
              if (tablesData.length === 0 && (dbType === 'mysql' || dbType === 'mariadb')) {
                console.log(`[DatabaseSidebar] Attempt 2: No tables found, trying with empty database parameter`);
                
                const [tables2, views2, functions2] = await Promise.all([
                  secureDatabaseService
                    .getTables(activeConnectionId, '', databaseName)
                    .then((result) => {
                      console.log(`[DatabaseSidebar] Tables fetched (attempt 2):`, result);
                      return result;
                    })
                    .catch((err) => {
                      console.error(`[DatabaseSidebar] Failed to fetch tables (attempt 2):`, err);
                      return [];
                    }),
                  secureDatabaseService
                    .getViews(activeConnectionId, '', databaseName)
                    .then((result) => {
                      console.log(`[DatabaseSidebar] Views fetched (attempt 2):`, result);
                      return result;
                    })
                    .catch((err) => {
                      console.error(`[DatabaseSidebar] Failed to fetch views (attempt 2):`, err);
                      return [];
                    }),
                  secureDatabaseService
                    .getFunctions(activeConnectionId, '', databaseName)
                    .then((result) => {
                      console.log(`[DatabaseSidebar] Functions fetched (attempt 2):`, result);
                      return result;
                    })
                    .catch((err) => {
                      console.error(`[DatabaseSidebar] Failed to fetch functions (attempt 2):`, err);
                      return [];
                    }),
                ]);
                
                if (tables2.length > 0 || views2.length > 0) {
                  tablesData = tables2;
                  viewsData = views2;
                  functionsData = functions2;
                }
              }
              
              tables = tablesData;
              views = viewsData;
              functions = functionsData;
              
              console.log(`[DatabaseSidebar] Final results - Tables: ${tables.length}, Views: ${views.length}, Functions: ${functions.length}`);
              
              if (tables.length === 0 && views.length === 0) {
                console.warn(`[DatabaseSidebar] WARNING: No tables or views found for ${dbType} database`);
                console.warn(`[DatabaseSidebar] This could mean:`);
                console.warn(`[DatabaseSidebar] 1. The database is empty`);
                console.warn(`[DatabaseSidebar] 2. The user lacks permissions`);
                console.warn(`[DatabaseSidebar] 3. The database/schema parameters are incorrect`);
              }
            } catch (error) {
              console.error(`[DatabaseSidebar] Unexpected error during fetch:`, error);
              console.error('[DatabaseSidebar] Error type:', typeof error);
              console.error('[DatabaseSidebar] Error details:', JSON.stringify(error, null, 2));
              
              // Check if it's a connection issue
              if (error instanceof Error && error.message.includes('not found')) {
                console.error('[DatabaseSidebar] Connection not found error - connection ID might be wrong');
                console.error('[DatabaseSidebar] Using connection ID:', activeConnectionId);
              }
              
              tables = [];
              views = [];
              functions = [];
            }
          } else {
            // For PostgreSQL and others: use schema iteration
            console.log(`[DatabaseSidebar] Fetching data for ${dbType} (with schema iteration)`);
            
            // First, get all available schemas
            const schemas = await secureDatabaseService
              .getSchemas(activeConnectionId, databaseName)
              .catch((err) => {
                console.error("[DatabaseSidebar] Failed to fetch schemas:", err);
                return ['public']; // Fallback to public schema
              });

            console.log("[DatabaseSidebar] Available schemas:", schemas);
            
            // Fetch tables/views/functions from all schemas in parallel
            const schemaPromises = schemas.map(async (schema) => {
              const [tables, views, functions] = await Promise.all([
                secureDatabaseService
                  .getTables(activeConnectionId, databaseName, schema)
                  .catch((err) => {
                    console.error(`[DatabaseSidebar] Failed to fetch tables for schema ${schema}:`, err);
                    return [];
                  }),
                secureDatabaseService
                  .getViews(activeConnectionId, databaseName, schema)
                  .catch((err) => {
                    console.error(`[DatabaseSidebar] Failed to fetch views for schema ${schema}:`, err);
                    return [];
                  }),
                secureDatabaseService
                  .getFunctions(activeConnectionId, databaseName, schema)
                  .catch((err) => {
                    console.error(`[DatabaseSidebar] Failed to fetch functions for schema ${schema}:`, err);
                    return [];
                  }),
              ]);
              return { tables, views, functions };
            });

            const schemaResults = await Promise.all(schemaPromises);
            
            // Combine results from all schemas
            tables = schemaResults.flatMap(r => r.tables);
            views = schemaResults.flatMap(r => r.views);
            functions = schemaResults.flatMap(r => r.functions);
          }

          tablesData = tables;
          viewsData = views;
          functionsData = functions;

          console.log(
            "[DatabaseSidebar] Fetched data - tables:",
            tablesData.length,
            "views:",
            viewsData.length,
            "functions:",
            functionsData.length,
          );
          console.log("[DatabaseSidebar] Sample table data:", tablesData.slice(0, 3));

          // Cache the schema
          await cacheService.setSchema(
            activeConnectionId,
            tablesData,
            viewsData,
            functionsData,
          );
        }
      } else {
        console.log("[DatabaseSidebar] Force refresh, bypassing cache");
        
        // Determine database name based on connection type
        const databaseName = 
          (activeConnection?.config.type === 'mysql' || activeConnection?.config.type === 'mariadb')
            ? activeConnection.config.database || ''
            : '';
        
        let tables: TableInfo[];
        let views: ViewInfo[];
        let functions: FunctionInfo[];
        
        // Handle different database types
        const dbType = activeConnection?.config.type;
        
        if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'sqlite') {
          // For MySQL/MariaDB/SQLite: fetch directly without schema iteration
          console.log(`[DatabaseSidebar] Force refresh - Fetching data for ${dbType} (no schema iteration)`);
          
          const schemaName = dbType === 'sqlite' ? 'main' : databaseName;
          
          const [tablesData, viewsData, functionsData] = await Promise.all([
            secureDatabaseService
              .getTables(activeConnectionId, databaseName, schemaName)
              .catch((err) => {
                console.error(`[DatabaseSidebar] Force refresh - Failed to fetch tables:`, err);
                return [];
              }),
            secureDatabaseService
              .getViews(activeConnectionId, databaseName, schemaName)
              .catch((err) => {
                console.error(`[DatabaseSidebar] Force refresh - Failed to fetch views:`, err);
                return [];
              }),
            secureDatabaseService
              .getFunctions(activeConnectionId, databaseName, schemaName)
              .catch((err) => {
                console.error(`[DatabaseSidebar] Force refresh - Failed to fetch functions:`, err);
                return [];
              }),
          ]);
          
          tables = tablesData;
          views = viewsData;
          functions = functionsData;
        } else {
          // For PostgreSQL and others: use schema iteration
          console.log(`[DatabaseSidebar] Force refresh - Fetching data for ${dbType} (with schema iteration)`);
          
          // First, get all available schemas
          const schemas = await secureDatabaseService
            .getSchemas(activeConnectionId, databaseName)
            .catch((err) => {
              console.error("[DatabaseSidebar] Force refresh - Failed to fetch schemas:", err);
              return ['public']; // Fallback to public schema
            });

          console.log("[DatabaseSidebar] Force refresh - Available schemas:", schemas);
          
          // Fetch tables/views/functions from all schemas in parallel
          const schemaPromises = schemas.map(async (schema) => {
            const [tables, views, functions] = await Promise.all([
              secureDatabaseService
                .getTables(activeConnectionId, databaseName, schema)
                .catch((err) => {
                  console.error(`[DatabaseSidebar] Force refresh - Failed to fetch tables for schema ${schema}:`, err);
                  return [];
                }),
              secureDatabaseService
                .getViews(activeConnectionId, databaseName, schema)
                .catch((err) => {
                  console.error(`[DatabaseSidebar] Force refresh - Failed to fetch views for schema ${schema}:`, err);
                  return [];
                }),
              secureDatabaseService
                .getFunctions(activeConnectionId, databaseName, schema)
                .catch((err) => {
                  console.error(`[DatabaseSidebar] Force refresh - Failed to fetch functions for schema ${schema}:`, err);
                  return [];
                }),
            ]);
            return { tables, views, functions };
          });

          const schemaResults = await Promise.all(schemaPromises);
          
          // Combine results from all schemas
          tables = schemaResults.flatMap(r => r.tables);
          views = schemaResults.flatMap(r => r.views);
          functions = schemaResults.flatMap(r => r.functions);
        }

        tablesData = tables;
        viewsData = views;
        functionsData = functions;

        console.log(
          "[DatabaseSidebar] Force refresh - Fetched data - tables:",
          tablesData.length,
          "views:",
          viewsData.length,
          "functions:",
          functionsData.length,
        );

        // Update cache
        await cacheService.setSchema(
          activeConnectionId,
          tablesData,
          viewsData,
          functionsData,
        );
      }

      // Extract unique schemas from all data
      const schemasFromTables = new Set<string>();
      
      // Add schemas from tables
      tablesData.forEach(table => {
        if (table.schema) {
          schemasFromTables.add(table.schema);
        }
      });
      
      // Add schemas from views
      viewsData.forEach(view => {
        if (view.schema) {
          schemasFromTables.add(view.schema);
        }
      });
      
      // Add schemas from functions
      functionsData.forEach(func => {
        if (func.schema) {
          schemasFromTables.add(func.schema);
        }
      });
      
      // Convert to sorted array and filter out empty strings
      const extractedSchemas = Array.from(schemasFromTables)
        .filter(schema => schema && schema.trim() !== "")
        .sort();
      
      console.log("[DatabaseSidebar] Extracted schemas from data:", extractedSchemas);
      
      // Set available schemas
      setAvailableSchemas(extractedSchemas);
      
      // Set or adjust selected schema if needed
      if (!extractedSchemas.includes(selectedSchema) || forceResetSchema) {
        const targetSchema = extractedSchemas.includes("public") 
          ? "public" 
          : extractedSchemas[0] || "all";
        setSelectedSchema(targetSchema);
      }
      
      // Store ALL data (unfiltered)
      console.log(`[DatabaseSidebar] Setting state - Tables: ${tablesData.length}, Views: ${viewsData.length}, Functions: ${functionsData.length}`);
      setTables(tablesData);
      setViews(viewsData);
      setFunctions(functionsData);
      console.log(`[DatabaseSidebar] State set successfully`);
    } catch (error) {
      console.error("Error loading schema:", error);
    } finally {
      setIsLoadingSchema(false);
    }
  };

  // Track previous connection to detect switches
  const previousConnectionIdRef = useRef<string | null>(null);
  const loadedForConnectionRef = useRef<string | null>(null);

  useEffect(() => {
    console.log("[DatabaseSidebar] useEffect triggered:", {
      activeConnectionId,
      status: activeConnection?.status,
      previousConnectionId: previousConnectionIdRef.current,
      loadedFor: loadedForConnectionRef.current,
    });

    if (activeConnectionId && activeConnection?.status === "connected") {
      // Check if we switched to a different database
      const isSwitch =
        previousConnectionIdRef.current !== null &&
        previousConnectionIdRef.current !== activeConnectionId;

      // Check if we already loaded data for this connection
      const alreadyLoaded =
        loadedForConnectionRef.current === activeConnectionId;

      console.log(
        "[DatabaseSidebar] Connected state detected, isSwitch:",
        isSwitch,
        "alreadyLoaded:",
        alreadyLoaded,
      );

      if (isSwitch) {
        // Reset everything when switching databases
        console.log("[DatabaseSidebar] Switching databases, resetting state");
        setSelectedSchema("public");
        setTables([]);
        setViews([]);
        setFunctions([]);
        setAvailableSchemas([]);
        loadedForConnectionRef.current = null; // Reset loaded tracker
      }

      // Load schema data if not already loaded for this connection
      if (!alreadyLoaded) {
        console.log(
          "[DatabaseSidebar] Loading database schema for:",
          activeConnectionId,
        );
        void loadDatabaseSchema(isSwitch); // Pass isSwitch to force reset on database switch
        loadedForConnectionRef.current = activeConnectionId;
      }

      previousConnectionIdRef.current = activeConnectionId;
    } else if (!activeConnectionId) {
      // Clear all data when no connection
      console.log("[DatabaseSidebar] No active connection, clearing data");
      setTables([]);
      setViews([]);
      setFunctions([]);
      setAvailableSchemas([]);
      setSelectedSchema("public");
      previousConnectionIdRef.current = null;
      loadedForConnectionRef.current = null;
    } else {
      console.log(
        "[DatabaseSidebar] Connection not ready yet, status:",
        activeConnection?.status,
      );
    }
  }, [activeConnectionId, activeConnection?.status]);

  const handleItemClick = (item: TreeItem & { schema?: string; initialViewMode?: "data" | "structure" | "indexes" | "triggers" }) => {
    if (!workspaceId || !activeConnectionId) return;

    // Check if tab already exists
    const existingTab = tabs.find((tab) => {
      if (
        tab.type === "table" &&
        (item.type === "table" || item.type === "view")
      ) {
        return (
          tab.payload?.tableName === item.name &&
          tab.payload?.schema === (item.schema || selectedSchema)
        );
      } else if (tab.type === "schema" && item.type === "function") {
        return (
          tab.payload?.objectName === item.name &&
          tab.payload?.schema === (item.schema || selectedSchema)
        );
      }
      return false;
    });

    if (!existingTab) {
      // Create appropriate tab based on type
      const tabId = addTab(workspaceId, {
        type:
          item.type === "table" || item.type === "view"
            ? "table"
            : item.type === "function"
            ? "schema"
            : "query",
        title: item.name,
        connectionId: activeConnectionId,
        payload: {
          schema: item.schema || selectedSchema,
          tableName:
            item.type === "table" || item.type === "view"
              ? item.name
              : undefined,
          tableType:
            item.type === "view"
              ? "view"
              : item.type === "table"
              ? "table"
              : undefined,
          objectName: item.type === "function" ? item.name : undefined,
          objectType: item.type === "function" ? "function" : undefined,
          initialViewMode: item.initialViewMode,
        },
      });
      setActiveTab(workspaceId, tabId);
    } else {
      // If tab exists, update its initialViewMode if different and set it as active
      if (item.initialViewMode && existingTab.payload?.initialViewMode !== item.initialViewMode) {
        updateTabPayload(workspaceId, existingTab.id, {
          ...existingTab.payload,
          initialViewMode: item.initialViewMode,
        });
      }
      setActiveTab(workspaceId, existingTab.id);
    }
  };

  const isItemActive = (item: {
    name: string;
    type: string;
    schema?: string;
  }) => {
    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    if (!currentTab) return false;

    const itemSchema = item.schema || selectedSchema;

    if (
      (item.type === "table" || item.type === "view") &&
      currentTab.type === "table"
    ) {
      return (
        currentTab.payload?.tableName === item.name &&
        currentTab.payload?.schema === itemSchema
      );
    } else if (item.type === "function" && currentTab.type === "schema") {
      return (
        currentTab.payload?.objectName === item.name &&
        currentTab.payload?.schema === itemSchema
      );
    }

    return false;
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "table":
        return <Table className="h-4 w-4 text-blue-500" />;
      case "view":
        return <Eye className="h-4 w-4 text-green-500" />;
      case "function":
        return <Code className="h-4 w-4 text-purple-500" />;
      default:
        return null;
    }
  };

  // Filter objects by selected schema (client-side filtering)
  const filteredTables = selectedSchema === "all" 
    ? tables 
    : tables.filter(t => t.schema === selectedSchema || (!t.schema && selectedSchema === ""));
  
  const filteredViews = selectedSchema === "all"
    ? views
    : views.filter(v => v.schema === selectedSchema || (!v.schema && selectedSchema === ""));
  
  const filteredFunctions = selectedSchema === "all"
    ? functions
    : functions.filter(f => f.schema === selectedSchema || (!f.schema && selectedSchema === ""));

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Fixed Header Section */}
      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Schema Selector */}
        <div className="flex items-center justify-start px-2 py-1.5 bg-background">
          {/* Connection Switcher */}
          <div className="flex items-center gap-1.5">
            <Database className="h-3 w-3 text-muted-foreground" />

            <Select
              value={activeConnectionId || ""}
              onValueChange={handleConnectionChange}
            >
              <SelectTrigger className="!h-5 text-xs border-0 bg-transparent hover:bg-primary/10 px-2 py-0 gap-1 min-w-[120px]">
                <SelectValue placeholder="Select connection">
                  {activeConnection
                    ? activeConnection.config.name
                    : "No connection"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {workspaceConnections.map((connection) => (
                  <SelectItem
                    key={connection.config.id}
                    value={connection.config.id}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          connection.status === "connected"
                            ? "bg-green-500"
                            : connection.status === "connecting"
                            ? "bg-yellow-500"
                            : "bg-gray-400"
                        }`}
                      />
                      <span>{connection.config.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {connection.config.type}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schema Selector */}
          {activeConnection &&
            connectionStatus === "connected" &&
            availableSchemas.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-muted-foreground" />
                <Select
                  value={selectedSchema}
                  onValueChange={setSelectedSchema}
                >
                  <SelectTrigger className="!h-5 text-xs border-0 bg-transparent hover:bg-primary/10 px-2 py-0 gap-1 min-w-[80px]">
                    <SelectValue placeholder="Schema">
                      {selectedSchema === "all"
                        ? "All Schemas"
                        : selectedSchema}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Schemas</SelectItem>
                    {availableSchemas.map((schema) => (
                      <SelectItem key={schema} value={schema}>
                        {schema}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
        </div>

        {/* Search with Refresh */}
        <div className="px-2 flex items-center p-2">
          <div className="relative flex items-center gap-2 flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search objects..."
              className="pl-7 h-6 text-xs border-0 bg-background/60"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => {
                // Invalidate cache and force refresh
                if (workspaceActiveConnectionId) {
                  cacheService.invalidateConnection(
                    workspaceActiveConnectionId,
                  );
                  void loadDatabaseSchema(true);
                }
              }}
              title="Refresh schema"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Database Objects - Only show when connected */}
          {activeConnectionId && activeConnection?.status === "connected" ? (
            isLoadingSchema ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-xs text-muted-foreground">
                  Loading schema...
                </span>
              </div>
            ) : (
              <>
                {/* Tables - Only show if there are tables */}
                {filteredTables.length > 0 && (
                  <div className="mb-2">
                    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start h-8 px-2"
                        onClick={() => {
                          toggleExpand("Tables");
                        }}
                      >
                        {expanded.includes("Tables") ? (
                          <ChevronDown className="h-4 w-4 mr-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-1" />
                        )}
                        <span className="font-medium text-xs">Tables</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {filteredTables.length}
                        </span>
                      </Button>
                    </div>

                    {expanded.includes("Tables") && (
                      <div className="ml-4 mt-1">
                        {filteredTables
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item, index) => (
                            <div
                              key={`table-${item.schema}.${item.name}-${index}`}
                              className="relative group"
                            >
                              <Button
                                variant={
                                  isItemActive({
                                    name: item.name,
                                    type: "table",
                                    schema: item.schema,
                                  })
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="sm"
                                className={cn(
                                  "w-full justify-start h-7 px-2 mb-0.5 text-xs",
                                  isItemActive({
                                    name: item.name,
                                    type: "table",
                                    schema: item.schema,
                                  }) && "font-medium",
                                )}
                                onClick={() => {
                                  handleItemClick({
                                    name: item.name,
                                    type: "table",
                                    schema: item.schema,
                                  });
                                }}
                              >
                                {getIcon("table")}
                                <span className="ml-2 truncate">{item.name}</span>
                                {item.schema &&
                                  item.schema !== selectedSchema && (
                                    <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                      {item.schema}
                                    </span>
                                  )}
                              </Button>
                              {/* Hover action buttons */}
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Open structure view
                                    handleItemClick({
                                      name: item.name,
                                      type: "table",
                                      schema: item.schema,
                                      initialViewMode: "structure",
                                    });
                                  }}
                                  title="View Structure"
                                >
                                  <Bolt className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Open indexes view
                                    handleItemClick({
                                      name: item.name,
                                      type: "table",
                                      schema: item.schema,
                                      initialViewMode: "indexes",
                                    });
                                  }}
                                  title="View Indexes"
                                >
                                  <Zap className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Views - Only show if there are views */}
                {filteredViews.length > 0 && (
                  <div className="mb-2">
                    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-2 px-2 py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start h-8 px-2"
                        onClick={() => {
                          toggleExpand("Views");
                        }}
                      >
                        {expanded.includes("Views") ? (
                          <ChevronDown className="h-4 w-4 mr-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-1" />
                        )}
                        <span className="font-medium text-xs">Views</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {filteredViews.length}
                        </span>
                      </Button>
                    </div>

                    {expanded.includes("Views") && (
                      <div className="ml-4 mt-1">
                        {filteredViews
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item, index) => (
                            <div
                              key={`view-${item.schema}.${item.name}-${index}`}
                              className="relative group"
                            >
                              <Button
                                variant={
                                  isItemActive({
                                    name: item.name,
                                    type: "view",
                                    schema: item.schema,
                                  })
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="sm"
                                className={cn(
                                  "w-full justify-start h-7 px-2 mb-0.5 text-xs",
                                  isItemActive({
                                    name: item.name,
                                    type: "view",
                                    schema: item.schema,
                                  }) && "font-medium",
                                )}
                                onClick={() => {
                                  handleItemClick({
                                    name: item.name,
                                    type: "view",
                                    schema: item.schema,
                                  });
                                }}
                              >
                                {getIcon("view")}
                                <span className="ml-2 truncate">{item.name}</span>
                                {item.schema &&
                                  item.schema !== selectedSchema && (
                                    <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                      {item.schema}
                                    </span>
                                  )}
                              </Button>
                              {/* Hover action button for views */}
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Open structure view
                                    handleItemClick({
                                      name: item.name,
                                      type: "view",
                                      schema: item.schema,
                                      initialViewMode: "structure",
                                    });
                                  }}
                                  title="View Structure"
                                >
                                  <Bolt className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Functions - Only show if there are functions */}
                {filteredFunctions.length > 0 && (
                  <div className="mb-2">
                    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-2 px-2 py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start h-8 px-2"
                        onClick={() => {
                          toggleExpand("Functions");
                        }}
                      >
                        {expanded.includes("Functions") ? (
                          <ChevronDown className="h-4 w-4 mr-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-1" />
                        )}
                        <span className="font-medium text-xs">Functions</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {filteredFunctions.length}
                        </span>
                      </Button>
                    </div>

                    {expanded.includes("Functions") && (
                      <div className="ml-4 mt-1">
                        {filteredFunctions
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item, index) => (
                            <Button
                              key={`function-${item.schema}.${item.name}-${index}`}
                              variant={
                                isItemActive({
                                  name: item.name,
                                  type: "function",
                                  schema: item.schema,
                                })
                                  ? "secondary"
                                  : "ghost"
                              }
                              size="sm"
                              className={cn(
                                "w-full justify-start h-7 px-2 mb-0.5 text-xs group",
                                isItemActive({
                                  name: item.name,
                                  type: "function",
                                  schema: item.schema,
                                }) && "font-medium",
                              )}
                              onClick={() => {
                                handleItemClick({
                                  name: item.name,
                                  type: "function",
                                  schema: item.schema,
                                });
                              }}
                            >
                              {getIcon("function")}
                              <span className="ml-2 truncate">{item.name}</span>
                              {item.schema &&
                                item.schema !== selectedSchema && (
                                  <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                    {item.schema}
                                  </span>
                                )}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground mb-2">
                No Database Connected
              </p>
              <p className="text-xs text-muted-foreground/70">
                Connect to a database to explore schema objects
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
