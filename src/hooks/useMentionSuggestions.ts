import { useMemo } from "react";
import type { AIContext, AIConnectionContext } from "@/types/aiContext";

// =============================================================================
// Types
// =============================================================================

export interface MentionItem {
  mentionType: "connection" | "table" | "view" | "function" | "tab";
  name: string;
  schema?: string;
  connectionId?: string;
  connectionName?: string;
  database?: string;
  /** Unique tab identifier for disambiguating tabs across panels */
  tabId?: string;
  displayLabel: string;
}

export interface SuggestionGroup {
  label: string;
  /** Subtitle shown next to the group label (e.g. db type, database name) */
  subtitle?: string;
  /** Group header is selectable as a connection mention */
  connectionItem?: MentionItem;
  items: MentionItem[];
  overflowHint?: string;
}

// =============================================================================
// Constants
// =============================================================================

const FOCUSED_PREVIEW = 5;
const OTHER_PREVIEW = 3;
const FILTERED_MAX = 20;

const SCHEMA_SUPPORTED_DB_TYPES = new Set(["PostgreSQL", "SQLServer"]);

// =============================================================================
// Filter Parsing
// =============================================================================

type TypeFilter = "table" | "view" | "function" | "tab";

interface ParsedFilter {
  conn?: string;
  schema?: string;
  typeFilter?: TypeFilter;
  text: string;
}

const TYPE_PREFIXES: Record<string, TypeFilter> = {
  "tab:": "tab",
  "tabs:": "tab",
  "table:": "table",
  "tables:": "table",
  "view:": "view",
  "views:": "view",
  "fn:": "function",
  "func:": "function",
  "function:": "function",
};

/**
 * Parse the filter string (text after @) into structured parts.
 *
 * Examples:
 *   ""               → { text: "" }
 *   "DevDB/"         → { conn: "DevDB", text: "" }
 *   "DevDB/public."  → { conn: "DevDB", schema: "public", text: "" }
 *   "DevDB/public.us"→ { conn: "DevDB", schema: "public", text: "us" }
 *   "user"           → { text: "user" }
 *   '"My DB"/public.'→ { conn: "My DB", schema: "public", text: "" }
 */
export function parseFilter(raw: string): ParsedFilter {
  if (!raw) return { text: "" };

  // Handle type prefixes: tab:, table:, view:, fn:, etc.
  const lower = raw.toLowerCase();
  for (const [prefix, typeFilter] of Object.entries(TYPE_PREFIXES)) {
    if (lower.startsWith(prefix)) {
      return { typeFilter, text: raw.slice(prefix.length) };
    }
  }

  let conn: string | undefined;
  let rest: string;

  // Check for quoted connection name
  if (raw.startsWith('"')) {
    const closeQuote = raw.indexOf('"', 1);
    if (closeQuote > 0 && raw[closeQuote + 1] === "/") {
      conn = raw.slice(1, closeQuote);
      rest = raw.slice(closeQuote + 2);
    } else {
      // Incomplete quote — treat as plain text
      return { text: raw };
    }
  } else {
    const slashIdx = raw.indexOf("/");
    if (slashIdx >= 0) {
      conn = raw.slice(0, slashIdx);
      rest = raw.slice(slashIdx + 1);
    } else {
      return { text: raw };
    }
  }

  // rest is everything after "ConnName/"
  // Could be "", "public.", "public.us"
  const dotIdx = rest.indexOf(".");
  if (dotIdx >= 0) {
    const schema = rest.slice(0, dotIdx);
    const text = rest.slice(dotIdx + 1);
    return { conn, schema: schema || undefined, text };
  }

  return { conn, text: rest };
}

// =============================================================================
// Helpers
// =============================================================================

function hasSchemaSupport(dbType: string): boolean {
  return SCHEMA_SUPPORTED_DB_TYPES.has(dbType);
}

function makeConnectionItem(conn: AIConnectionContext): MentionItem {
  return {
    mentionType: "connection",
    name: conn.name,
    connectionId: conn.id,
    connectionName: conn.name,
    database: conn.database,
    displayLabel: conn.name,
  };
}

function makeObjectItem(
  type: "table" | "view" | "function",
  name: string,
  schema: string,
  conn: AIConnectionContext,
): MentionItem {
  const showSchema = hasSchemaSupport(conn.dbType);
  return {
    mentionType: type,
    name,
    schema,
    connectionId: conn.id,
    connectionName: conn.name,
    database: conn.database,
    displayLabel: showSchema ? `${schema}.${name}` : name,
  };
}

function makeTabItem(tab: OpenTab, multiConnection: boolean): MentionItem {
  let displayLabel = tab.name;
  if (multiConnection && tab.connectionName) {
    displayLabel = `${tab.name} · ${tab.connectionName}`;
  }
  return {
    mentionType: "tab",
    name: tab.name,
    tabId: tab.id,
    connectionId: tab.connectionId,
    connectionName: tab.connectionName,
    displayLabel,
  };
}

function collectItemsFromConnection(
  conn: AIConnectionContext,
  filter: string,
  schemaFilter?: string,
  typeFilter?: TypeFilter,
): MentionItem[] {
  const items: MentionItem[] = [];
  const lowerFilter = filter.toLowerCase();

  // SQL paradigm: iterate schemas
  for (const schema of conn.schemas) {
    if (schemaFilter !== undefined && schema.name !== schemaFilter) continue;

    if (!typeFilter || typeFilter === "table") {
      for (const table of schema.tables) {
        if (!lowerFilter || table.toLowerCase().includes(lowerFilter)) {
          items.push(makeObjectItem("table", table, schema.name, conn));
        }
      }
    }
    if (!typeFilter || typeFilter === "view") {
      for (const view of schema.views) {
        if (!lowerFilter || view.toLowerCase().includes(lowerFilter)) {
          items.push(makeObjectItem("view", view, schema.name, conn));
        }
      }
    }
    if (!typeFilter || typeFilter === "function") {
      for (const func of schema.functions) {
        if (!lowerFilter || func.toLowerCase().includes(lowerFilter)) {
          items.push(makeObjectItem("function", func, schema.name, conn));
        }
      }
    }
  }

  // MongoDB paradigm: list collections as tables
  if (conn.collections && (!typeFilter || typeFilter === "table")) {
    for (const coll of conn.collections) {
      if (!lowerFilter || coll.name.toLowerCase().includes(lowerFilter)) {
        items.push({
          mentionType: "table",
          name: coll.name,
          connectionId: conn.id,
          connectionName: conn.name,
          database: conn.database,
          displayLabel: coll.name,
        });
      }
    }
  }

  // Redis paradigm: list key patterns as tables
  if (conn.keyPatterns && (!typeFilter || typeFilter === "table")) {
    for (const kp of conn.keyPatterns) {
      if (!lowerFilter || kp.pattern.toLowerCase().includes(lowerFilter)) {
        items.push({
          mentionType: "table",
          name: kp.pattern,
          connectionId: conn.id,
          connectionName: conn.name,
          database: conn.database,
          displayLabel: `${kp.pattern} (${kp.count})`,
        });
      }
    }
  }

  return items;
}

function buildGroupLabel(conn: AIConnectionContext): string {
  return conn.name;
}

function buildGroupSubtitle(conn: AIConnectionContext): string {
  const parts: string[] = [conn.dbType];
  if (conn.database) parts.push(conn.database);
  if (hasSchemaSupport(conn.dbType) && conn.schemas.length > 1) {
    parts.push(`${conn.schemas.length} schemas`);
  }
  if (conn.collections) {
    parts.push(`${conn.collections.length} collections`);
  }
  if (conn.keyPatterns) {
    parts.push(`${conn.keyPatterns.length} patterns`);
  }
  return parts.join(" · ");
}

// =============================================================================
// Core Pure Function
// =============================================================================

export interface OpenTab {
  id: string;
  name: string;
  type: string;
  panelId: string;
  connectionId?: string;
  connectionName?: string;
}

export function buildSuggestionGroups(
  aiContext: AIContext,
  openTabs: OpenTab[],
  filter: string,
  focusedConnectionId?: string,
): SuggestionGroup[] {
  const parsed = parseFilter(filter);
  const multiConnection = aiContext.connections.length > 1;

  // --- Type-filtered (tab:, table:, view:, fn:) ---
  if (parsed.typeFilter) {
    if (parsed.typeFilter === "tab") {
      const tabFilter = parsed.text.toLowerCase();
      const matchingTabs = openTabs.filter((t) =>
        t.name.toLowerCase().includes(tabFilter),
      );
      if (matchingTabs.length === 0) return [];
      return [{ label: "Tabs", items: matchingTabs.map((t) => makeTabItem(t, multiConnection)) }];
    }

    // table:, view:, fn: — filter across all connections
    const groups: SuggestionGroup[] = [];
    const sorted = [...aiContext.connections].sort((a, b) => {
      if (a.id === focusedConnectionId) return -1;
      if (b.id === focusedConnectionId) return 1;
      return 0;
    });

    for (const conn of sorted) {
      const items = collectItemsFromConnection(conn, parsed.text, undefined, parsed.typeFilter);
      if (items.length === 0) continue;
      groups.push({
        label: buildGroupLabel(conn),
        subtitle: buildGroupSubtitle(conn),
        connectionItem: makeConnectionItem(conn),
        items: items.slice(0, FILTERED_MAX),
        overflowHint:
          items.length > FILTERED_MAX
            ? `${items.length - FILTERED_MAX} more — type to filter`
            : undefined,
      });
    }
    return groups;
  }

  // --- Connection-scoped (with or without schema) ---
  if (parsed.conn !== undefined) {
    const connFilter = parsed.conn;
    const conn = aiContext.connections.find(
      (c) => c.name.toLowerCase() === connFilter.toLowerCase(),
    );
    if (!conn) return [];

    if (parsed.schema !== undefined) {
      // Connection + schema scoped
      const items = collectItemsFromConnection(
        conn,
        parsed.text,
        parsed.schema,
      );
      const schemaShow = hasSchemaSupport(conn.dbType);
      const groupLabel = schemaShow
        ? `${conn.name} / ${parsed.schema}`
        : conn.name;

      return [
        {
          label: groupLabel,
          subtitle: buildGroupSubtitle(conn),
          connectionItem: makeConnectionItem(conn),
          items: items.slice(0, FILTERED_MAX),
          overflowHint:
            items.length > FILTERED_MAX
              ? `${items.length - FILTERED_MAX} more — type to filter`
              : undefined,
        },
      ];
    }

    // Connection scoped, no schema
    // Group by schema
    const groups: SuggestionGroup[] = [];
    for (const schema of conn.schemas) {
      const items = collectItemsFromConnection(conn, parsed.text, schema.name);
      if (items.length === 0) continue;

      const schemaShow = hasSchemaSupport(conn.dbType);
      const groupLabel = schemaShow
        ? `${conn.name} / ${schema.name}`
        : conn.name;

      groups.push({
        label: groupLabel,
        subtitle: buildGroupSubtitle(conn),
        connectionItem: makeConnectionItem(conn),
        items: items.slice(0, FILTERED_MAX),
        overflowHint:
          items.length > FILTERED_MAX
            ? `${items.length - FILTERED_MAX} more — type to filter`
            : undefined,
      });
    }
    return groups;
  }

  // --- No scope ---
  if (!parsed.text) {
    // Empty filter: show all connections grouped, focused first
    const groups: SuggestionGroup[] = [];

    // Sort: focused connection first
    const sorted = [...aiContext.connections].sort((a, b) => {
      if (a.id === focusedConnectionId) return -1;
      if (b.id === focusedConnectionId) return 1;
      return 0;
    });

    for (const conn of sorted) {
      const isFocused = conn.id === focusedConnectionId;
      const limit = isFocused ? FOCUSED_PREVIEW : OTHER_PREVIEW;
      const allItems = collectItemsFromConnection(conn, "");

      groups.push({
        label: buildGroupLabel(conn),
        subtitle: buildGroupSubtitle(conn),
        connectionItem: makeConnectionItem(conn),
        items: allItems.slice(0, limit),
        overflowHint:
          allItems.length > limit
            ? `${allItems.length - limit} more — type to filter`
            : undefined,
      });
    }

    // Tabs at bottom
    if (openTabs.length > 0) {
      groups.push({
        label: "Tabs",
        items: openTabs.map((t) => makeTabItem(t, multiConnection)),
      });
    }

    return groups;
  }

  // --- No scope, with text filter ---
  const groups: SuggestionGroup[] = [];
  const lowerText = parsed.text.toLowerCase();

  // Sort: focused connection first
  const sorted = [...aiContext.connections].sort((a, b) => {
    if (a.id === focusedConnectionId) return -1;
    if (b.id === focusedConnectionId) return 1;
    return 0;
  });

  for (const conn of sorted) {
    const connNameMatches = conn.name.toLowerCase().includes(lowerText);
    const items = collectItemsFromConnection(conn, parsed.text);

    // Show group if connection name matches OR it has matching objects
    if (!connNameMatches && items.length === 0) continue;

    groups.push({
      label: buildGroupLabel(conn),
      subtitle: buildGroupSubtitle(conn),
      connectionItem: makeConnectionItem(conn),
      items: items.slice(0, FILTERED_MAX),
      overflowHint:
        items.length > FILTERED_MAX
          ? `${items.length - FILTERED_MAX} more — type to filter`
          : undefined,
    });
  }

  // Filter tabs too
  const matchingTabs = openTabs.filter((t) =>
    t.name.toLowerCase().includes(parsed.text.toLowerCase()),
  );
  if (matchingTabs.length > 0) {
    groups.push({
      label: "Tabs",
      items: matchingTabs.map((t) => makeTabItem(t, multiConnection)),
    });
  }

  return groups;
}

// =============================================================================
// flattenSelectableItems
// =============================================================================

/**
 * Flatten all selectable items from groups for keyboard navigation.
 * Includes connection header items and regular items.
 */
export function flattenSelectableItems(groups: SuggestionGroup[]): MentionItem[] {
  const result: MentionItem[] = [];
  for (const group of groups) {
    if (group.connectionItem) {
      result.push(group.connectionItem);
    }
    result.push(...group.items);
  }
  return result;
}

// =============================================================================
// Hook
// =============================================================================

export function useMentionSuggestions(
  aiContext: AIContext,
  openTabs: OpenTab[],
  filter: string,
  focusedConnectionId?: string,
): { groups: SuggestionGroup[]; flatItems: MentionItem[] } {
  const groups = useMemo(
    () =>
      buildSuggestionGroups(aiContext, openTabs, filter, focusedConnectionId),
    [aiContext, openTabs, filter, focusedConnectionId],
  );

  const flatItems = useMemo(() => flattenSelectableItems(groups), [groups]);

  return { groups, flatItems };
}
