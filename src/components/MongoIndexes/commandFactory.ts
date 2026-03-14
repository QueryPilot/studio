import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandPayload,
  CrudCommandTarget,
  JsonValue,
} from "@/types/crud";
import type { MongoIndexOptions } from "@/adapters/types/mongodb";

export function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = toJsonValue(entry);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }

  return undefined;
}

export function normalizeIndexOptionsForCrud(
  options: MongoIndexOptions,
): Record<string, JsonValue> {
  const normalized = toJsonValue(options);
  return normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? normalized
    : {};
}

export function buildMongoCommand<TPayload extends CrudCommandPayload>(
  type:
    | "document.index.create"
    | "document.index.drop"
    | "document.validation.update",
  target: CrudCommandTarget,
  payload: TPayload,
  description: string,
  entityName?: string,
): CrudCommand<TPayload> {
  return {
    id: nanoid(),
    type,
    target: {
      ...target,
      entityName,
    },
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description,
      source: "ui",
    },
    state: "staged",
  };
}
