/**
 * ERD tab metadata shape for Phase 5.
 *
 * Legacy (Phase 4 and earlier): `{ type: "erd", schema: string, ... }`.
 * Phase 5: `{ type: "erd", schemas: string[], ... }`.
 *
 * The reader below performs migration-on-read without mutating the
 * persisted record — the new shape is written the next time the tab
 * metadata is saved via `openErdView`/`updateTabMetadata`.
 */
export interface ErdTabMetadataLike {
  type?: string;
  schema?: string;
  schemas?: readonly string[] | string[];
}

export function readErdTabSchemas(meta: ErdTabMetadataLike): string[] {
  if (Array.isArray(meta.schemas)) return meta.schemas.slice();
  if (typeof meta.schema === "string" && meta.schema.length > 0) {
    return [meta.schema];
  }
  return [];
}
