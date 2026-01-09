import type { UnifiedItem } from "./useCommandPaletteQueries";
import { DbType } from "@/types/connection";

export interface ActionItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: string;
  disabled?: boolean;
  destructive?: boolean;
}

export type ActionHandler = (item: UnifiedItem, context: ActionContext) => void | Promise<void>;

export interface ActionContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  dbType: DbType | null;
  closePalette: () => void;
}

export interface ActionDefinition extends ActionItem {
  handler: ActionHandler;
  /** Only show for specific database types */
  supportedDbTypes?: DbType[];
}

// Action IDs
export const ACTION_IDS = {
  // Table/View actions
  OPEN_DATA: "open-data",
  OPEN_STRUCTURE: "open-structure",
  OPEN_INDEXES: "open-indexes",
  OPEN_TRIGGERS: "open-triggers",
  OPEN_DESIGNER: "open-designer",
  OPEN_DEFINITION: "open-definition",
  REFRESH_MATERIALIZED_VIEW: "refresh-materialized-view",
  COPY_NAME: "copy-name",
  COPY_QUALIFIED_NAME: "copy-qualified-name",
  ADD_TO_FAVORITES: "add-to-favorites",

  // Function actions
  COPY_CALL_SIGNATURE: "copy-call-signature",

  // Schema actions
  MARK_AS_DEFAULT: "mark-as-default",
  CREATE_SCHEMA: "create-schema",

  // Database actions
  CREATE_DATABASE: "create-database",

  // Command actions
  EXECUTE: "execute",
  COPY_COMMAND_ID: "copy-command-id",
} as const;

// Database types that support schema creation
export const SCHEMA_CREATION_SUPPORTED: DbType[] = [
  DbType.PostgreSQL,
  DbType.MySQL,
  DbType.MariaDB,
  DbType.SQLServer,
];

// Database types that support database creation via SQL
export const DATABASE_CREATION_SUPPORTED: DbType[] = [
  DbType.PostgreSQL,
  DbType.MySQL,
  DbType.MariaDB,
  DbType.SQLServer,
];
