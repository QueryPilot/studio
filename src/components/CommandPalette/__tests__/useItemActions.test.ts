import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_IDS } from "../actions";
import { useItemActions } from "../useItemActions";
import { DbType } from "@/types/connection";
import type { UnifiedItem } from "../useCommandPaletteQueries";

const openTableObjectMock = vi.hoisted(() => vi.fn());
const openFunctionObjectMock = vi.hoisted(() => vi.fn());
const openMongoCollectionObjectMock = vi.hoisted(() => vi.fn());
const openMongoCollectionMetadataMock = vi.hoisted(() => vi.fn());
const openRedisDatabaseObjectMock = vi.hoisted(() => vi.fn());
const openRedisCliTabMock = vi.hoisted(() => vi.fn());
const openQueryWithSqlMock = vi.hoisted(() => vi.fn());
const writeClipboardTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const buildRedisSelectCommandMock = vi.hoisted(() => vi.fn((dbIndex: number) => `SELECT ${dbIndex}`));
const executeCommandMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const workspaceSelectionState = vi.hoisted(() => ({
  connectionId: "active-conn",
  database: "active-db",
  schema: "active-schema",
}));

const connectionStoreState = vi.hoisted(() => ({
  getConnection: (connectionId: string) => {
    if (connectionId === "active-conn") {
      return {
        profile: {
          db_type: DbType.MySQL,
        },
      };
    }
    return undefined;
  },
}));

vi.mock("@/utils/workbench/openers", () => ({
  openTableObject: openTableObjectMock,
  openFunctionObject: openFunctionObjectMock,
  openMongoCollectionObject: openMongoCollectionObjectMock,
  openMongoCollectionMetadata: openMongoCollectionMetadataMock,
  openRedisDatabaseObject: openRedisDatabaseObjectMock,
  openRedisCliTab: openRedisCliTabMock,
  openQueryWithSql: openQueryWithSqlMock,
  getCreateDatabaseTemplate: vi.fn(() => "CREATE DATABASE test_db;"),
  getCreateSchemaTemplate: vi.fn(() => "CREATE SCHEMA test_schema;"),
}));

vi.mock("@/stores/workspaceSelectionStore", () => ({
  useWorkspaceSelectionStore: (selector: (state: typeof workspaceSelectionState) => unknown) =>
    selector(workspaceSelectionState),
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: (selector: (state: typeof connectionStoreState) => unknown) =>
    selector(connectionStoreState),
}));

vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServicesOptional: () => ({
    commandService: {
      execute: executeCommandMock,
    },
  }),
}));

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: writeClipboardTextMock,
}));

vi.mock("@/screens/workspace/components/sidebarContextMenuHelpers", () => ({
  buildRedisSelectCommand: buildRedisSelectCommandMock,
}));

vi.mock("@/adapters", () => ({
  getAdapterForConnection: vi.fn(),
}));

vi.mock("@/services/queryStreamClient", () => ({
  queryStreamClient: {
    streamWithCallbacks: vi.fn(),
  },
}));

vi.mock("@/stores/dataInvalidationStore", () => ({
  useDataInvalidationStore: {
    getState: () => ({
      invalidateTable: vi.fn(),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

function makeBaseItem(overrides: Partial<UnifiedItem>): UnifiedItem {
  return {
    id: "item-id",
    type: "table",
    name: "users",
    subtitle: "",
    keywords: ["users"],
    connectionId: "item-conn",
    connectionName: "Item Connection",
    database: "item-db",
    schema: "public",
    dbType: DbType.PostgreSQL,
    ...overrides,
  };
}

describe("useItemActions", () => {
  beforeEach(() => {
    openTableObjectMock.mockClear();
    openFunctionObjectMock.mockClear();
    openMongoCollectionObjectMock.mockClear();
    openMongoCollectionMetadataMock.mockClear();
    openRedisDatabaseObjectMock.mockClear();
    openRedisCliTabMock.mockClear();
    openQueryWithSqlMock.mockClear();
    writeClipboardTextMock.mockClear();
    buildRedisSelectCommandMock.mockClear();
    executeCommandMock.mockClear();
  });

  it("returns the agreed action matrix for each main item type", () => {
    const closePalette = vi.fn();

    const tableItem = makeBaseItem({
      type: "table",
      table: { schema: "public", name: "users", kind: "Table" },
    });
    const viewItem = makeBaseItem({
      type: "view",
      table: { schema: "public", name: "active_users", kind: "View" },
      name: "active_users",
    });
    const materializedViewItem = makeBaseItem({
      type: "materializedView",
      table: { schema: "public", name: "mv_users", kind: "MaterializedView" },
      name: "mv_users",
    });
    const functionItem = makeBaseItem({
      type: "function",
      func: {
        schema: "public",
        name: "fn_users",
        return_type: "text",
        arguments: [],
      },
      name: "fn_users",
    });
    const collectionItem = makeBaseItem({
      type: "collection",
      database: "analytics",
      collection: {
        name: "events",
      },
      name: "events",
      schema: undefined,
    });
    const redisItem = makeBaseItem({
      type: "redisDatabase",
      name: "db2",
      database: "2",
      redisDatabase: {
        db: 2,
        keys: 20,
        expires: 5,
      },
      schema: undefined,
    });
    const commandItem = makeBaseItem({
      type: "command",
      id: "command:workbench.action.refreshAll",
      name: "Refresh",
      command: {
        id: "workbench.action.refreshAll",
        label: "Refresh",
        source: "default",
        category: "Workbench",
      },
      connectionId: undefined,
      database: undefined,
      schema: undefined,
      dbType: undefined,
    });

    const { result: tableResult } = renderHook(() => useItemActions(tableItem, closePalette));
    const { result: viewResult } = renderHook(() => useItemActions(viewItem, closePalette));
    const { result: materializedViewResult } = renderHook(() => useItemActions(materializedViewItem, closePalette));
    const { result: functionResult } = renderHook(() => useItemActions(functionItem, closePalette));
    const { result: collectionResult } = renderHook(() => useItemActions(collectionItem, closePalette));
    const { result: redisResult } = renderHook(() => useItemActions(redisItem, closePalette));
    const { result: commandResult } = renderHook(() => useItemActions(commandItem, closePalette));

    expect(tableResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DATA,
      ACTION_IDS.OPEN_STRUCTURE,
      ACTION_IDS.OPEN_INDEXES,
      ACTION_IDS.OPEN_TRIGGERS,
      ACTION_IDS.OPEN_DEFINITION,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_QUALIFIED_NAME,
    ]);

    expect(viewResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DATA,
      ACTION_IDS.OPEN_STRUCTURE,
      ACTION_IDS.OPEN_DEFINITION,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_QUALIFIED_NAME,
    ]);

    expect(materializedViewResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DATA,
      ACTION_IDS.OPEN_STRUCTURE,
      ACTION_IDS.OPEN_INDEXES,
      ACTION_IDS.OPEN_DEFINITION,
      ACTION_IDS.REFRESH_MATERIALIZED_VIEW,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_QUALIFIED_NAME,
    ]);

    expect(functionResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DEFINITION,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_QUALIFIED_NAME,
      ACTION_IDS.COPY_CALL_SIGNATURE,
    ]);

    expect(collectionResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DATA,
      ACTION_IDS.OPEN_METADATA,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_QUALIFIED_NAME,
    ]);

    expect(redisResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.OPEN_DATA,
      ACTION_IDS.OPEN_REDIS_CLI,
      ACTION_IDS.COPY_NAME,
      ACTION_IDS.COPY_REDIS_SELECT_COMMAND,
    ]);

    expect(commandResult.current.actions.map((action) => action.id)).toEqual([
      ACTION_IDS.EXECUTE,
    ]);
  });

  it("uses selected item connection/database context for execution", async () => {
    const closePalette = vi.fn();
    const tableItem = makeBaseItem({
      type: "table",
      table: { schema: "public", name: "users", kind: "Table" },
      connectionId: "item-conn",
      database: "item-db",
    });

    const { result } = renderHook(() => useItemActions(tableItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_DATA);
    });

    expect(openTableObjectMock).toHaveBeenCalledWith({
      table: tableItem.table,
      connectionId: "item-conn",
      database: "item-db",
      viewType: "data",
    });
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens collection metadata action for collection items", async () => {
    const closePalette = vi.fn();
    const collectionItem = makeBaseItem({
      type: "collection",
      name: "events",
      collection: { name: "events" },
      connectionId: "mongo-conn",
      database: "analytics",
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(collectionItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_METADATA);
    });

    expect(openMongoCollectionMetadataMock).toHaveBeenCalledWith({
      connectionId: "mongo-conn",
      database: "analytics",
      collectionName: "events",
    });
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens collection data action for collection items", async () => {
    const closePalette = vi.fn();
    const collectionItem = makeBaseItem({
      type: "collection",
      name: "events",
      collection: { name: "events" },
      connectionId: "mongo-conn",
      database: "analytics",
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(collectionItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_DATA);
    });

    expect(openMongoCollectionObjectMock).toHaveBeenCalledWith({
      connectionId: "mongo-conn",
      database: "analytics",
      collectionName: "events",
    });
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens redis data action for redis database items", async () => {
    const closePalette = vi.fn();
    const redisItem = makeBaseItem({
      type: "redisDatabase",
      name: "db5",
      database: "5",
      redisDatabase: {
        db: 5,
        keys: 120,
        expires: 10,
      },
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(redisItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_DATA);
    });

    expect(openRedisDatabaseObjectMock).toHaveBeenCalledWith({
      connectionId: "item-conn",
      dbIndex: 5,
    });
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("opens redis cli action for redis database items", async () => {
    const closePalette = vi.fn();
    const redisItem = makeBaseItem({
      type: "redisDatabase",
      name: "db5",
      database: "5",
      redisDatabase: {
        db: 5,
        keys: 120,
        expires: 10,
      },
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(redisItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_REDIS_CLI);
    });

    expect(openRedisCliTabMock).toHaveBeenCalledWith({
      connectionId: "item-conn",
      dbIndex: 5,
    });
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("copies redis SELECT command using shared helper", async () => {
    const closePalette = vi.fn();
    const redisItem = makeBaseItem({
      type: "redisDatabase",
      name: "db5",
      database: "5",
      redisDatabase: {
        db: 5,
        keys: 120,
        expires: 10,
      },
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(redisItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.COPY_REDIS_SELECT_COMMAND);
    });

    expect(buildRedisSelectCommandMock).toHaveBeenCalledWith(5);
    expect(writeClipboardTextMock).toHaveBeenCalledWith("SELECT 5");
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("copies qualified names for function and collection items", async () => {
    const functionClosePalette = vi.fn();
    const functionItem = makeBaseItem({
      type: "function",
      name: "fn_users",
      schema: "public",
      func: {
        schema: "public",
        name: "fn_users",
        return_type: "text",
        arguments: [],
      },
    });
    const { result: functionResult } = renderHook(() => useItemActions(functionItem, functionClosePalette));

    await act(async () => {
      await functionResult.current.executeAction(ACTION_IDS.COPY_QUALIFIED_NAME);
    });

    expect(writeClipboardTextMock).toHaveBeenCalledWith("public.fn_users");
    expect(functionClosePalette).toHaveBeenCalledTimes(1);

    const collectionClosePalette = vi.fn();
    const collectionItem = makeBaseItem({
      type: "collection",
      name: "events",
      collection: { name: "events" },
      connectionId: "mongo-conn",
      database: "analytics",
      schema: undefined,
    });
    const { result: collectionResult } = renderHook(() => useItemActions(collectionItem, collectionClosePalette));

    await act(async () => {
      await collectionResult.current.executeAction(ACTION_IDS.COPY_QUALIFIED_NAME);
    });

    expect(writeClipboardTextMock).toHaveBeenLastCalledWith("analytics.events");
    expect(collectionClosePalette).toHaveBeenCalledTimes(1);
  });

  it("skips redis actions when redis db index is invalid", async () => {
    const closePalette = vi.fn();
    const redisItem = makeBaseItem({
      type: "redisDatabase",
      name: "db-invalid",
      database: undefined,
      redisDatabase: {
        db: -1,
        keys: 0,
        expires: 0,
      },
      schema: undefined,
    });

    const { result } = renderHook(() => useItemActions(redisItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.OPEN_DATA);
      await result.current.executeAction(ACTION_IDS.OPEN_REDIS_CLI);
      await result.current.executeAction(ACTION_IDS.COPY_REDIS_SELECT_COMMAND);
    });

    expect(openRedisDatabaseObjectMock).not.toHaveBeenCalled();
    expect(openRedisCliTabMock).not.toHaveBeenCalled();
    expect(buildRedisSelectCommandMock).not.toHaveBeenCalled();
    expect(writeClipboardTextMock).not.toHaveBeenCalled();
    expect(closePalette).not.toHaveBeenCalled();
  });

  it("executes command actions via command service", async () => {
    const closePalette = vi.fn();
    const commandItem = makeBaseItem({
      type: "command",
      id: "command:workbench.action.refreshAll",
      name: "Refresh",
      command: {
        id: "workbench.action.refreshAll",
        label: "Refresh",
        source: "default",
        category: "Workbench",
      },
      connectionId: undefined,
      database: undefined,
      schema: undefined,
      dbType: undefined,
    });

    const { result } = renderHook(() => useItemActions(commandItem, closePalette));

    await act(async () => {
      await result.current.executeAction(ACTION_IDS.EXECUTE);
    });

    expect(executeCommandMock).toHaveBeenCalledWith("workbench.action.refreshAll");
    expect(closePalette).toHaveBeenCalledTimes(1);
  });
});
