import { create } from "zustand";
// import { invoke } from "@tauri-apps/api/core";
import type { SchemaInfo, TableInfo, FunctionInfo } from "@/types/workspaceScreen";

interface SchemaState {
  schemas: Map<string, SchemaInfo[]>;
  tables: Map<string, TableInfo[]>;
  views: Map<string, TableInfo[]>;
  functions: Map<string, FunctionInfo[]>;
  selectedSchema: string;
  searchQuery: string;
  expandedNodes: Set<string>;
  loading: boolean;
  lastRefreshed: Date | null;
  
  // Actions
  loadSchemas: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, schema: string) => Promise<void>;
  loadViews: (connectionId: string, schema: string) => Promise<void>;
  loadFunctions: (connectionId: string, schema: string) => Promise<void>;
  setSelectedSchema: (schema: string) => void;
  setSearchQuery: (query: string) => void;
  toggleNode: (nodeId: string) => void;
  refreshAll: (connectionId: string) => Promise<void>;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: new Map(),
  tables: new Map(),
  views: new Map(),
  functions: new Map(),
  selectedSchema: "public",
  searchQuery: "",
  expandedNodes: new Set(),
  loading: false,
  lastRefreshed: null,

  loadSchemas: async (connectionId) => {
    set({ loading: true });
    try {
      // TODO: Replace with actual API call
      // const schemas = await invoke<SchemaInfo[]>("db_list_schemas", { connectionId });
      
      // Mock data for now
      const schemas: SchemaInfo[] = [
        { name: "public", owner: "postgres" },
        { name: "information_schema", owner: "postgres" },
        { name: "pg_catalog", owner: "postgres" },
      ];
      
      const schemaMap = new Map(get().schemas);
      schemaMap.set(connectionId, schemas);
      
      set({ 
        schemas: schemaMap, 
        loading: false,
        lastRefreshed: new Date(),
      });
      
      // Load tables for default schema
      if (schemas.length > 0) {
        await get().loadTables(connectionId, "public");
      }
    } catch (error) {
      console.error("Failed to load schemas:", error);
      set({ loading: false });
    }
  },

  loadTables: async (connectionId, schema) => {
    try {
      // TODO: Replace with actual API call
      // const tables = await invoke<TableInfo[]>("db_list_tables", { connectionId, schema });
      
      // Mock data for now
      const tables: TableInfo[] = [
        { schema, name: "users", type: "table", rowCount: 1234 },
        { schema, name: "products", type: "table", rowCount: 567 },
        { schema, name: "orders", type: "table", rowCount: 8910 },
        { schema, name: "customers", type: "table", rowCount: 456 },
      ];
      
      const tableKey = `${connectionId}:${schema}`;
      const tableMap = new Map(get().tables);
      tableMap.set(tableKey, tables);
      
      set({ tables: tableMap });
    } catch (error) {
      console.error("Failed to load tables:", error);
    }
  },

  loadViews: async (connectionId, schema) => {
    try {
      // TODO: Replace with actual API call
      // const views = await invoke<TableInfo[]>("db_list_views", { connectionId, schema });
      
      // Mock data for now
      const views: TableInfo[] = [
        { schema, name: "user_summary", type: "view" },
        { schema, name: "order_stats", type: "view" },
        { schema, name: "product_catalog", type: "materialized_view" },
      ];
      
      const viewKey = `${connectionId}:${schema}`;
      const viewMap = new Map(get().views);
      viewMap.set(viewKey, views);
      
      set({ views: viewMap });
    } catch (error) {
      console.error("Failed to load views:", error);
    }
  },

  loadFunctions: async (connectionId, schema) => {
    try {
      // TODO: Replace with actual API call
      // const functions = await invoke<FunctionInfo[]>("db_list_functions", { connectionId, schema });
      
      // Mock data for now
      const functions: FunctionInfo[] = [
        { 
          schema, 
          name: "calculate_total", 
          returnType: "numeric",
          arguments: ["order_id integer"],
        },
        { 
          schema, 
          name: "generate_report", 
          returnType: "text",
          arguments: ["start_date date", "end_date date"],
        },
        { 
          schema, 
          name: "update_inventory", 
          returnType: "void",
          arguments: ["product_id integer", "quantity integer"],
        },
      ];
      
      const functionKey = `${connectionId}:${schema}`;
      const functionMap = new Map(get().functions);
      functionMap.set(functionKey, functions);
      
      set({ functions: functionMap });
    } catch (error) {
      console.error("Failed to load functions:", error);
    }
  },

  setSelectedSchema: (schema) => set({ selectedSchema: schema }),
  
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  toggleNode: (nodeId) => set((state) => {
    const newExpanded = new Set(state.expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    return { expandedNodes: newExpanded };
  }),

  refreshAll: async (connectionId) => {
    const state = get();
    await state.loadSchemas(connectionId);
    await state.loadTables(connectionId, state.selectedSchema);
    await state.loadViews(connectionId, state.selectedSchema);
    await state.loadFunctions(connectionId, state.selectedSchema);
  },
}));