export type MongoOperationKind =
  | "find"
  | "aggregate"
  | "count"
  | "command"
  | "insert"
  | "update"
  | "delete"
  | "unknown";

export type MongoExecutionResultKind =
  | "documents"
  | "scalar"
  | "command"
  | "mutation"
  | "error";

export interface MongoExecutionResult {
  operation: MongoOperationKind;
  kind: MongoExecutionResultKind;
  raw: unknown;
  supportsDataView: boolean;
  collection?: string;
  errorMessage?: string;
}

interface NormalizeMongoResultInput {
  operation: MongoOperationKind;
  result?: unknown;
  error?: unknown;
  collection?: string;
}

function stringifyMongoResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDocumentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDocumentArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const documents = value.filter(isDocumentRecord);
  return documents.length === value.length ? documents : null;
}

export function extractMongoResultDocuments(
  result: MongoExecutionResult,
): Record<string, unknown>[] | null {
  const directDocuments = getDocumentArray(result.raw);
  if (directDocuments) {
    return directDocuments;
  }

  if (!isDocumentRecord(result.raw)) {
    return null;
  }

  const cursor = result.raw.cursor;
  if (!isDocumentRecord(cursor)) {
    return null;
  }

  return getDocumentArray(cursor.firstBatch);
}

export function normalizeMongoResult({
  operation,
  result,
  error,
  collection,
}: NormalizeMongoResultInput): MongoExecutionResult {
  if (error !== undefined) {
    const errorMessage = normalizeErrorMessage(error);
    const raw = { error: errorMessage };

    return {
      operation,
      kind: "error",
      raw,
      supportsDataView: false,
      collection,
      errorMessage,
    };
  }

  const kind: MongoExecutionResultKind =
    operation === "find" || operation === "aggregate"
      ? "documents"
      : operation === "count"
        ? "scalar"
        : operation === "insert" ||
            operation === "update" ||
            operation === "delete"
          ? "mutation"
          : "command";

  const normalizedResult: MongoExecutionResult = {
    operation,
    kind,
    raw: result,
    supportsDataView: false,
    collection,
  };

  normalizedResult.supportsDataView =
    extractMongoResultDocuments(normalizedResult) !== null;

  return normalizedResult;
}

export function formatMongoExecutionResult(
  result: MongoExecutionResult,
): string {
  return stringifyMongoResult(result.raw);
}
