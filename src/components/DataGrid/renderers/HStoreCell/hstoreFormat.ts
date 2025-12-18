/* eslint-disable @typescript-eslint/restrict-plus-operands */
const collapseWhitespaceOutsideQuotes = (input: string): string => {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
};

const escapeHstoreComponent = (input: string): string =>
  input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const unescapeHstoreComponent = (input: string): string =>
  input.replace(/\\(["\\])/g, "$1");

const serializeHstoreValue = (input: unknown): string => {
  if (input === null || input === undefined) return "NULL";
  if (typeof input === "number" || typeof input === "bigint") {
    return `"${String(input)}"`;
  }
  if (typeof input === "boolean") {
    return input ? '"true"' : '"false"';
  }
  return `"${escapeHstoreComponent(
    typeof input === "string" ? input : JSON.stringify(input),
  )}"`;
};

export const hstoreToEditorText = (
  value: string | null | undefined,
): string => {
  if (!value) return "";
  const trimmed = value.trim();
  let result = "";
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const prev = trimmed[i - 1];

    if (char === '"' && prev !== "\\") {
      inQuotes = !inQuotes;
    }

    result += char;

    if (char === "," && !inQuotes) {
      result += "\n";
      while (trimmed[i + 1] === " ") {
        i += 1;
      }
    }
  }

  return result.trim();
};

interface ParsedHstorePair {
  key: string;
  value: string | null;
  index: number;
}

const splitByUnquotedComma = (input: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const prev = input[i - 1];

    if (char === '"' && prev !== "\\") {
      inQuotes = !inQuotes;
    }

    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
};

const stripTrailingComma = (input: string): string => {
  let inQuotes = false;
  let lastCommaIndex = -1;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const prev = input[i - 1];

    if (char === '"' && prev !== "\\") {
      inQuotes = !inQuotes;
    }

    if (!inQuotes && char === ",") {
      lastCommaIndex = i;
    }
  }

  if (lastCommaIndex === -1) return input;

  for (let i = input.length - 1; i >= 0; i--) {
    const char = input[i];
    if (char === " " || char === "\t") continue;
    if (i === lastCommaIndex) {
      return input.slice(0, i);
    }
    break;
  }

  return input;
};

const extractEditorSegments = (text: string): string[] => {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split(/\n+/);
  const segments: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const parts = splitByUnquotedComma(trimmedLine);
    for (const part of parts) {
      const cleaned = stripTrailingComma(part).trim();
      if (cleaned.length === 0) continue;
      segments.push(cleaned);
    }
  }

  return segments;
};

const parseKeyOrValue = (
  input: string,
): { value: string; consumedAll: boolean } | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length === 1) return null;
    const inner = trimmed.slice(1, -1);
    return { value: unescapeHstoreComponent(inner), consumedAll: true };
  }

  return { value: trimmed, consumedAll: true };
};

const findArrowIndex = (segment: string): number => {
  let inQuotes = false;
  for (let i = 0; i < segment.length - 1; i++) {
    const char = segment[i];
    const prev = segment[i - 1];
    if (char === '"' && prev !== "\\") {
      inQuotes = !inQuotes;
    }
    if (!inQuotes && char === "=" && segment[i + 1] === ">") {
      return i;
    }
  }
  return -1;
};

const parseSegment = (
  segment: string,
  index: number,
): ParsedHstorePair | null => {
  const arrowIndex = findArrowIndex(segment);
  if (arrowIndex === -1) return null;

  const keyPart = segment.slice(0, arrowIndex).trim();
  const valuePart = segment.slice(arrowIndex + 2).trim();

  if (!keyPart) return null;

  const keyParsed = parseKeyOrValue(keyPart);
  if (!keyParsed) return null;

  if (!valuePart) return null;

  let value: string | null;
  if (/^NULL$/i.test(valuePart)) {
    value = null;
  } else {
    const valueParsed = parseKeyOrValue(valuePart);
    if (!valueParsed) return null;
    value = valueParsed.value;
  }

  return {
    key: keyParsed.value,
    value,
    index,
  };
};

export interface HstoreNormalizationResult {
  normalized: string | null;
  hasDuplicateKeys: boolean;
  duplicatesRemoved: number;
  parseErrors: boolean;
}

export const normalizeHstoreEditorText = (
  text: string | null | undefined,
): HstoreNormalizationResult => {
  if (text == null) {
    return {
      normalized: null,
      hasDuplicateKeys: false,
      duplicatesRemoved: 0,
      parseErrors: false,
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      normalized: null,
      hasDuplicateKeys: false,
      duplicatesRemoved: 0,
      parseErrors: false,
    };
  }

  const segments = extractEditorSegments(trimmed);
  if (segments.length === 0) {
    return {
      normalized: null,
      hasDuplicateKeys: false,
      duplicatesRemoved: 0,
      parseErrors: false,
    };
  }

  const parsedPairs: ParsedHstorePair[] = [];

  segments.forEach((segment, idx) => {
    const parsed = parseSegment(segment, idx);
    if (parsed) {
      parsedPairs.push(parsed);
    }
  });

  if (parsedPairs.length === 0) {
    return {
      normalized: collapseWhitespaceOutsideQuotes(segments.join(", ")) || null,
      hasDuplicateKeys: false,
      duplicatesRemoved: 0,
      parseErrors: true,
    };
  }

  const map = new Map<string, ParsedHstorePair>();
  parsedPairs.forEach((pair) => {
    map.set(pair.key, pair);
  });

  const uniquePairs = Array.from(map.values()).sort(
    (a, b) => a.index - b.index,
  );

  const duplicatesRemoved = parsedPairs.length - uniquePairs.length;

  const normalized = uniquePairs
    .map(
      ({ key, value }) =>
        `"${escapeHstoreComponent(key)}"=>${
          value === null ? "NULL" : `"${escapeHstoreComponent(value)}"`
        }`,
    )
    .join(", ");

  return {
    normalized: normalized.length ? normalized : null,
    hasDuplicateKeys: duplicatesRemoved > 0,
    duplicatesRemoved,
    parseErrors: false,
  };
};

export const hstoreFromEditorText = (
  text: string | null | undefined,
): string | null => normalizeHstoreEditorText(text).normalized;

export const hstoreDisplayText = (value: string | null | undefined): string => {
  if (!value) return "";
  return collapseWhitespaceOutsideQuotes(value);
};

export const coerceToHstoreString = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "string") {
    return normalizeHstoreEditorText(value).normalized ?? value;
  }

  if (Array.isArray(value)) {
    const raw = value
      .map((item, index) => `"${index}"=>${serializeHstoreValue(item)}`)
      .join(", ");
    return normalizeHstoreEditorText(raw).normalized ?? raw;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (record.kind === "hstore-cell" && typeof record.value === "string") {
      return normalizeHstoreEditorText(record.value).normalized ?? record.value;
    }

    const raw = Object.entries(record)
      .map(
        ([key, val]) =>
          `"${escapeHstoreComponent(
            typeof key === "string" ? key : JSON.stringify(key),
          )}"=>${serializeHstoreValue(val)}`,
      )
      .join(", ");

    return normalizeHstoreEditorText(raw).normalized ?? raw;
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value);
  return normalizeHstoreEditorText(stringValue).normalized ?? stringValue;
};
