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
import { useState, useEffect } from "react";
import { useTabsStore } from "@/stores/tabsStore";
import { useConnectionStore } from "@/stores";
import { secureDatabaseService } from "@/services/secureDatabaseService";
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
  const [selectedSchema, setSelectedSchema] = useState<string>("all");
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const { addTab, tabs } = useTabsStore();
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

  const loadDatabaseSchema = async () => {
    if (
      !activeConnection ||
      activeConnection.status !== "connected" ||
      !activeConnectionId
    )
      return;

    setIsLoadingSchema(true);
    try {
      // Fetch schema information from secure backend
      const [tablesData, viewsData, functionsData] = await Promise.all([
        secureDatabaseService.getTables(activeConnectionId),
        secureDatabaseService.getViews(activeConnectionId),
        secureDatabaseService.getFunctions(activeConnectionId),
      ]);

      setTables(tablesData);
      setViews(viewsData);
      setFunctions(functionsData);

      // Extract unique schemas from all objects
      const schemas = new Set<string>();
      tablesData.forEach((t) => schemas.add(t.schema));
      viewsData.forEach((v) => schemas.add(v.schema));
      functionsData.forEach((f) => schemas.add(f.schema));
      setAvailableSchemas(Array.from(schemas).sort());
    } catch (error) {
      console.error("Error loading schema:", error);
    } finally {
      setIsLoadingSchema(false);
    }
  };

  useEffect(() => {
    if (activeConnectionId && activeConnection?.status === "connected") {
      loadDatabaseSchema();
    } else if (!activeConnectionId) {
      setTables([]);
      setViews([]);
      setFunctions([]);
      setAvailableSchemas([]);
    }
  }, [activeConnectionId, activeConnection?.status]);

  const handleItemClick = (item: TreeItem) => {
    // Check if tab already exists
    const existingTab = tabs.find(
      (tab) => tab.name === item.name && tab.type === item.type,
    );
    if (!existingTab) {
      addTab({ name: item.name, type: item.type });
    } else {
      // If tab exists, just set it as active
      useTabsStore.getState().setActiveTab(existingTab.id);
    }
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
        <div className="p-2 space-y-2">
          {/* Schema Selector */}
          {activeConnectionId && activeConnection?.status === "connected" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  Schema
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={loadDatabaseSchema}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
              <Select value={selectedSchema} onValueChange={setSelectedSchema}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select schema" />
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

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search objects..."
              className="pl-8 h-8"
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
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-7 px-2 mb-0.5 text-sm group"
                            onClick={() =>
                              handleItemClick({
                                name: item.name,
                                type: "table",
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
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-7 px-2 mb-0.5 text-sm group"
                            onClick={() =>
                              handleItemClick({ name: item.name, type: "view" })
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
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-7 px-2 mb-0.5 text-sm group"
                            onClick={() =>
                              handleItemClick({
                                name: item.name,
                                type: "function",
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
