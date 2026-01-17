/**
 * AI-related type definitions
 */

export interface WorkspaceContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  activeTable: string | null;
  activeCollection: string | null;
  activeKey: string | null;
  activeQuery: string | null;
  recentTables: string[];
  recentCollections: string[];
  recentKeys: string[];
  lastAction: "browse" | "query" | "filter" | null;
}

export interface AIProvider {
  id: string;
  name: string;
  models: AIModel[];
}

export interface AIModel {
  id: string;
  name: string;
  contextLength?: number;
}
