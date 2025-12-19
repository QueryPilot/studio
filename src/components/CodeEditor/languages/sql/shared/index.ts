/**
 * Shared utilities for SQL language support.
 * Centralizes common functionality used across linter, completion, and context analysis.
 */

export {
  LRUCache,
  getInstanceCache,
  clearInstanceCaches,
  hashString,
  hashDocument,
  CACHE_CONFIG,
} from "./cache";

export {
  type TableRef,
  extractTablesFromRange,
  extractTableRefs,
  resolveTableAlias,
  parseCTEs,
  TABLE_CLAUSE_TYPES,
} from "./table-extraction";

export {
  type QualifiedInfo,
  type FullyQualifiedName,
  cleanIdentifier,
  getQualifiedInfo,
  getFullyQualifiedName,
  parseIdentifierParts,
  buildQualifiedName,
  isQualifiedIdentifier,
} from "./identifier";
