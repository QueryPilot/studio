import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useTabsStore } from "@/stores/tabsStore";
import { useConnectionStore } from "@/stores";
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
  const [selectedSchema, setSelectedSchema] = useState<string>("public");
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const { addTab, tabs, activeTab } = useTabsStore();
  const { connections, activeConnectionId } = useConnectionStore();

  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;

  const toggleExpand = (name: string) => {
    setExpanded((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  };

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
          // Fetch schema information from secure backend
          const results = await Promise.all([
            secureDatabaseService.getTables(activeConnectionId),
            secureDatabaseService.getViews(activeConnectionId),
            secureDatabaseService.getFunctions(activeConnectionId),
          ]);
          tablesData = results[0];
          viewsData = results[1];
          functionsData = results[2];
          
          // Cache the schema
          await cacheService.setSchema(activeConnectionId, tablesData, viewsData, functionsData);
        }
      } else {
        console.log("[DatabaseSidebar] Force refresh, bypassing cache");
        // Force refresh - bypass cache
        const results = await Promise.all([
          secureDatabaseService.getTables(activeConnectionId),
          secureDatabaseService.getViews(activeConnectionId),
          secureDatabaseService.getFunctions(activeConnectionId),
        ]);
        tablesData = results[0];
        viewsData = results[1];
        functionsData = results[2];
        
        // Update cache
        await cacheService.setSchema(activeConnectionId, tablesData, viewsData, functionsData);
      }

      setTables(tablesData);
      setViews(viewsData);
      setFunctions(functionsData);

      // Extract unique schemas from all objects
      const schemas = new Set<string>();
      tablesData.forEach((t) => {
        if (t.schema) schemas.add(t.schema);
      });
      viewsData.forEach((v) => {
        if (v.schema) schemas.add(v.schema);
      });
      functionsData.forEach((f) => {
        if (f.schema) schemas.add(f.schema);
      });
      const sortedSchemas = Array.from(schemas).sort();
      setAvailableSchemas(sortedSchemas);

      // Schema selection logic
      if (forceResetSchema || selectedSchema === "public") {
        // Always prefer "public" schema, especially when switching databases
        if (sortedSchemas.includes("public")) {
          setSelectedSchema("public");
        } else {
          // Fall back to first available schema or "all"
          setSelectedSchema(
            sortedSchemas.length > 0 ? sortedSchemas[0]! : "all",
          );
        }
      } else if (
        !sortedSchemas.includes(selectedSchema) &&
        selectedSchema !== "all"
      ) {
        // Current selection is invalid for this database
        if (sortedSchemas.includes("public")) {
          setSelectedSchema("public");
        } else {
          setSelectedSchema(
            sortedSchemas.length > 0 ? sortedSchemas[0]! : "all",
          );
        }
      }
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
        loadDatabaseSchema(isSwitch); // Pass isSwitch to force reset on database switch
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

  const handleItemClick = (item: TreeItem & { schema?: string }) => {
    // Check if tab already exists
    const existingTab = tabs.find(
      (tab) => tab.name === item.name && tab.type === item.type && tab.schema === item.schema,
    );
    if (!existingTab) {
      addTab({ name: item.name, type: item.type, schema: item.schema || selectedSchema });
    } else {
      // If tab exists, just set it as active
      useTabsStore.getState().setActiveTab(existingTab.id);
    }
  };

  const isItemActive = (item: { name: string; type: string; schema?: string }) => {
    const currentTab = tabs.find(tab => tab.id === activeTab);
    return currentTab?.name === item.name && 
           currentTab?.type === item.type && 
           currentTab?.schema === (item.schema || selectedSchema);
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
  const filteredTables =
    selectedSchema === "all"
      ? tables
      : tables.filter((t) => t.schema === selectedSchema);

  const filteredViews =
    selectedSchema === "all"
      ? views
      : views.filter((v) => v.schema === selectedSchema);

  const filteredFunctions =
    selectedSchema === "all"
      ? functions
      : functions.filter((f) => f.schema === selectedSchema);

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Fixed Header Section */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Schema Selector - aligned with tabs */}

        <div className="h-10 flex items-center justify-between px-2 py-0.5 border-b">
          <Select value={selectedSchema} onValueChange={setSelectedSchema}>
            <SelectTrigger className="h-8 border-0 bg-transparent px-2 !py-0 text-sm font-medium text-foreground focus:ring-0 hover:bg-transparent">
              <div className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Schema" />
              </div>
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
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
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

        {/* Search */}
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search objects..."
              className="pl-7 h-7 text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
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
                <span className="text-sm text-muted-foreground">
                  Loading schema...
                </span>
              </div>
            ) : (
              <>
                {/* Tables */}
                <div className="mb-2">
                  <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Tables")}
                    >
                      {expanded.includes("Tables") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Tables</span>
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
                        .map((item) => (
                          <Button
                            key={`${item.schema}.${item.name}`}
                            variant={isItemActive({ name: item.name, type: "table", schema: item.schema }) ? "secondary" : "ghost"}
                            size="sm"
                            className={cn(
                              "w-full justify-start h-7 px-2 mb-0.5 text-sm group",
                              isItemActive({ name: item.name, type: "table", schema: item.schema }) && "font-medium"
                            )}
                            onClick={() =>
                              handleItemClick({
                                name: item.name,
                                type: "table",
                                schema: item.schema,
                              })
                            }
                          >
                            {getIcon("table")}
                            <span className="ml-2 truncate">{item.name}</span>
                            {selectedSchema === "all" && (
                              <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                {item.schema}
                              </span>
                            )}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Views */}
                <div className="mb-2">
                  <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-2 px-2 py-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Views")}
                    >
                      {expanded.includes("Views") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Views</span>
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
                        .map((item) => (
                          <Button
                            key={`${item.schema}.${item.name}`}
                            variant={isItemActive({ name: item.name, type: "view", schema: item.schema }) ? "secondary" : "ghost"}
                            size="sm"
                            className={cn(
                              "w-full justify-start h-7 px-2 mb-0.5 text-sm group",
                              isItemActive({ name: item.name, type: "view", schema: item.schema }) && "font-medium"
                            )}
                            onClick={() =>
                              handleItemClick({ 
                                name: item.name, 
                                type: "view",
                                schema: item.schema,
                              })
                            }
                          >
                            {getIcon("view")}
                            <span className="ml-2 truncate">{item.name}</span>
                            {selectedSchema === "all" && (
                              <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                {item.schema}
                              </span>
                            )}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Functions */}
                <div className="mb-2">
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-2 px-2 py-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Functions")}
                    >
                      {expanded.includes("Functions") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Functions</span>
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
                        .map((item) => (
                          <Button
                            key={`${item.schema}.${item.name}`}
                            variant={isItemActive({ name: item.name, type: "function", schema: item.schema }) ? "secondary" : "ghost"}
                            size="sm"
                            className={cn(
                              "w-full justify-start h-7 px-2 mb-0.5 text-sm group",
                              isItemActive({ name: item.name, type: "function", schema: item.schema }) && "font-medium"
                            )}
                            onClick={() =>
                              handleItemClick({
                                name: item.name,
                                type: "function",
                                schema: item.schema,
                              })
                            }
                          >
                            {getIcon("function")}
                            <span className="ml-2 truncate">{item.name}</span>
                            {selectedSchema === "all" && (
                              <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
                                {item.schema}
                              </span>
                            )}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-2">
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
