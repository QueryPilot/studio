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
  kind: MongoExecutionResultKind;
  raw: unknown;
  formattedText: string;
  supportsDataView: boolean;
  documents?: Record<string, unknown>[];
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
      kind: "error",
      raw,
      formattedText: stringifyMongoResult(raw),
      supportsDataView: false,
      collection,
      errorMessage,
    };
  }

  if (
    (operation === "find" || operation === "aggregate") &&
    Array.isArray(result)
  ) {
    const documents = result.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );

    return {
      kind: "documents",
      raw: result,
      formattedText: stringifyMongoResult(result),
      supportsDataView: true,
      documents,
      collection,
    };
  }

  if (operation === "count" && typeof result === "number") {
    return {
      kind: "scalar",
      raw: result,
      formattedText: stringifyMongoResult(result),
      supportsDataView: false,
      collection,
    };
  }

  if (
    operation === "insert" ||
    operation === "update" ||
    operation === "delete"
  ) {
    return {
      kind: "mutation",
      raw: result,
      formattedText: stringifyMongoResult(result),
      supportsDataView: false,
      collection,
    };
  }

  return {
    kind: "command",
    raw: result,
    formattedText: stringifyMongoResult(result),
    supportsDataView: false,
    collection,
  };
}
