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
  Plus,
  Layers,
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
  const [lastLoadedSchema, setLastLoadedSchema] = useState<string | null>(null);

  const { id: workspaceId } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore((state) =>
    state.getWorkspace(workspaceId || ""),
  );
  const { addTab, setActiveTab } = useWorkspaceStore();
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

  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
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
    // Optimistically set the new connection as active immediately
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
        `[StatusBar] Initiating connection for ${connectionId} on selection`,
      );
      try {
        await connect(connectionId, 3, workspaceId);
      } catch (error) {
        console.error(`[StatusBar] Failed to connect:`, error);
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

      // First, fetch all available schemas
      const allSchemas = await secureDatabaseService.getSchemas(
        activeConnectionId,
        "",
      );
      console.log("[DatabaseSidebar] Found schemas:", allSchemas);
      const sortedSchemas = allSchemas.sort();
      setAvailableSchemas(sortedSchemas);

      // Determine which schema to use
      let targetSchema = selectedSchema;
      if (forceResetSchema || !sortedSchemas.includes(selectedSchema)) {
        // Reset to public or first available schema
        targetSchema = sortedSchemas.includes("public")
          ? "public"
          : sortedSchemas[0] || "public";
        setSelectedSchema(targetSchema);
      }

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

          // Fetch tables/views/functions for the selected schema only
          const [tables, views, functions] = await Promise.all([
            secureDatabaseService
              .getTables(activeConnectionId, "", targetSchema)
              .catch((err) => {
                console.error(
                  `[DatabaseSidebar] Failed to fetch tables for schema ${targetSchema}:`,
                  err,
                );
                return [];
              }),
            secureDatabaseService
              .getViews(activeConnectionId, "", targetSchema)
              .catch((err) => {
                console.error(
                  `[DatabaseSidebar] Failed to fetch views for schema ${targetSchema}:`,
                  err,
                );
                return [];
              }),
            secureDatabaseService
              .getFunctions(activeConnectionId, "", targetSchema)
              .catch((err) => {
                console.error(
                  `[DatabaseSidebar] Failed to fetch functions for schema ${targetSchema}:`,
                  err,
                );
                return [];
              }),
          ]);

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
        // Force refresh - bypass cache
        // Fetch tables/views/functions for the selected schema only
        const [tables, views, functions] = await Promise.all([
          secureDatabaseService
            .getTables(activeConnectionId, "", targetSchema)
            .catch((err) => {
              console.error(
                `[DatabaseSidebar] Force refresh - Failed to fetch tables for schema ${targetSchema}:`,
                err,
              );
              return [];
            }),
          secureDatabaseService
            .getViews(activeConnectionId, "", targetSchema)
            .catch((err) => {
              console.error(
                `[DatabaseSidebar] Force refresh - Failed to fetch views for schema ${targetSchema}:`,
                err,
              );
              return [];
            }),
          secureDatabaseService
            .getFunctions(activeConnectionId, "", targetSchema)
            .catch((err) => {
              console.error(
                `[DatabaseSidebar] Force refresh - Failed to fetch functions for schema ${targetSchema}:`,
                err,
              );
              return [];
            }),
        ]);

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

      setTables(tablesData);
      setViews(viewsData);
      setFunctions(functionsData);
      setLastLoadedSchema(targetSchema);
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
        // Reset lastLoadedSchema when connection changes
        setLastLoadedSchema(null);
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

  // Reload data when selected schema changes
  useEffect(() => {
    if (
      activeConnectionId &&
      activeConnection?.status === "connected" &&
      selectedSchema &&
      availableSchemas.length > 0 &&
      selectedSchema !== lastLoadedSchema
    ) {
      console.log("[DatabaseSidebar] Schema changed to:", selectedSchema);
      // Invalidate cache and reload for the new schema
      cacheService.invalidateConnection(activeConnectionId);
      void loadDatabaseSchema(false);
    }
  }, [selectedSchema, lastLoadedSchema]); // Depend on both selectedSchema and lastLoadedSchema

  const handleItemClick = (item: TreeItem & { schema?: string }) => {
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
        },
      });
      setActiveTab(workspaceId, tabId);
    } else {
      // If tab exists, just set it as active
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

  // Filter objects by selected schema
  // Since we now load data per schema, no filtering needed
  const filteredTables = tables;
  const filteredViews = views;
  const filteredFunctions = functions;

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
                cacheService.invalidateConnection(activeConnectionId!);
                loadDatabaseSchema(true);
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
                            <Button
                              key={`table-${item.schema}.${item.name}-${index}`}
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
                                "w-full justify-start h-7 px-2 mb-0.5 text-xs group",
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
                            <Button
                              key={`view-${item.schema}.${item.name}-${index}`}
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
                                "w-full justify-start h-7 px-2 mb-0.5 text-xs group",
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
