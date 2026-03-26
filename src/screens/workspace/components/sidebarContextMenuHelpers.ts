import { DbType } from "@/types/connection";

export interface SidebarSelectedTypes {
  tables: number;
  views: number;
  materializedViews: number;
  functions: number;
  collections: number;
}

export interface SqlTruncateOptionSupport {
  restartIdentity: boolean;
  cascade: boolean;
}

export function buildMongoCollectionMetadataQuery(collectionName: string): string {
  return JSON.stringify(
    {
      command: {
        listCollections: 1,
        filter: { name: collectionName },
        nameOnly: false,
      },
    },
    null,
    2,
  );
}

export function buildMongoCollectionMetadataCommand(collectionName: string): {
  listCollections: number;
  filter: { name: string };
  nameOnly: boolean;
} {
  return {
    listCollections: 1,
    filter: { name: collectionName },
    nameOnly: false,
  };
}

function totalSelected(selectedTypes: SidebarSelectedTypes): number {
  return (
    selectedTypes.tables +
    selectedTypes.views +
    selectedTypes.materializedViews +
    selectedTypes.functions +
    selectedTypes.collections
  );
}

function isCollectionsOnly(selectedTypes: SidebarSelectedTypes): boolean {
  return (
    selectedTypes.collections > 0 &&
    selectedTypes.tables === 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.materializedViews === 0 &&
    selectedTypes.functions === 0
  );
}

function hasAnySqlObject(selectedTypes: SidebarSelectedTypes): boolean {
  return (
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0 ||
    selectedTypes.functions > 0
  );
}

export function canCopyDefinition(selectedTypes: SidebarSelectedTypes): boolean {
  if (totalSelected(selectedTypes) === 0) return false;
  return hasAnySqlObject(selectedTypes) || isCollectionsOnly(selectedTypes);
}

export function canTruncate(selectedTypes: SidebarSelectedTypes): boolean {
  if (totalSelected(selectedTypes) === 0) return false;

  const isTablesOnly =
    selectedTypes.tables > 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.materializedViews === 0 &&
    selectedTypes.functions === 0 &&
    selectedTypes.collections === 0;

  return isTablesOnly || isCollectionsOnly(selectedTypes);
}

export function canDelete(selectedTypes: SidebarSelectedTypes): boolean {
  if (totalSelected(selectedTypes) === 0) return false;

  if (isCollectionsOnly(selectedTypes)) {
    return true;
  }

  if (selectedTypes.collections > 0 || selectedTypes.functions > 0) {
    return false;
  }

  return (
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0
  );
}

export function canSnapshotToDuckDb(selectedTypes: SidebarSelectedTypes): boolean {
  const total = totalSelected(selectedTypes);
  if (total !== 1) return false;

  if (selectedTypes.functions > 0) return false;

  return (
    selectedTypes.tables === 1 ||
    selectedTypes.views === 1 ||
    selectedTypes.materializedViews === 1 ||
    selectedTypes.collections === 1
  );
}

export function isImmediateExecution(selectedTypes: SidebarSelectedTypes): boolean {
  return isCollectionsOnly(selectedTypes);
}

export function buildMongoCollectionDefinition(
  collectionName: string,
  metadataResult: unknown,
): string {
  const metadata = (() => {
    if (
      typeof metadataResult === "object" &&
      metadataResult !== null &&
      "cursor" in metadataResult
    ) {
      const cursor = (metadataResult as { cursor?: { firstBatch?: unknown[] } }).cursor;
      const first = cursor?.firstBatch?.[0];
      if (first && typeof first === "object") {
        return first as Record<string, unknown>;
      }
    }
    return null;
  })();

  const output = {
    collection: collectionName,
    metadata: metadata ?? {
      note: "No metadata returned",
    },
  };

  return JSON.stringify(output, null, 2);
}

export function buildRedisSelectCommand(dbIndex: number): string {
  return `SELECT ${dbIndex}`;
}

export function buildRedisDatabaseDefinition(params: {
  dbIndex: number;
  keys: number;
  expires: number;
}): string {
  const output = {
    database: `db${params.dbIndex}`,
    dbIndex: params.dbIndex,
    keys: params.keys,
    expires: params.expires,
    selectCommand: buildRedisSelectCommand(params.dbIndex),
  };
  return JSON.stringify(output, null, 2);
}

export function getSqlTruncateOptionSupport(dbType: DbType): SqlTruncateOptionSupport {
  if (dbType === DbType.PostgreSQL) {
    return {
      restartIdentity: true,
      cascade: true,
    };
  }

  return {
    restartIdentity: false,
    cascade: false,
  };
}
