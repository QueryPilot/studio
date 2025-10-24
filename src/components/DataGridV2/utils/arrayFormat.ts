const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const escapePgString = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const formatArrayElementInline = (value: unknown): string => {
  if (Array.isArray(value)) {
    return formatPgArrayInline(value);
  }
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return `"${escapePgString(value)}"`;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatPgArrayInline = (arr: unknown[]): string =>
  `{${arr.map((item) => formatArrayElementInline(item)).join(",")}}`;

const formatPgArrayPretty = (arr: unknown[], level = 0): string => {
  const indent = "  ".repeat(level);
  const nextIndent = "  ".repeat(level + 1);
  if (arr.length === 0) return "{}";

  const lines = arr.map((item) => {
    if (Array.isArray(item)) {
      return `${nextIndent}${formatPgArrayPretty(item, level + 1)}`;
    }
    return `${nextIndent}${formatArrayElementInline(item)}`;
  });

  return `{\n${lines.join(",\n")}\n${indent}}`;
};

const tryParseJsonArray = (input: string): unknown[] | undefined => {
  if (!input) return undefined;
  const trimmed = input.trim();
  let candidate = trimmed;

  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    candidate = `[${candidate.slice(1, -1)}]`;
  }

  candidate = candidate.replace(/(?<!")\bNULL\b(?!")/gi, "null");
  candidate = candidate.replace(/(?<!")\bTRUE\b(?!")/gi, "true");
  candidate = candidate.replace(/(?<!")\bFALSE\b(?!")/gi, "false");
  candidate = candidate.replace(/(?<!")\bt\b(?!")/g, "true");
  candidate = candidate.replace(/(?<!")\bf\b(?!")/g, "false");

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const computeArrayStringsFromRaw = (
  rawValue: unknown,
): { pretty: string | null; inline: string | null } => {
  if (rawValue == null) {
    return { pretty: null, inline: null };
  }

  if (Array.isArray(rawValue)) {
    return {
      pretty: formatPgArrayPretty(rawValue),
      inline: formatPgArrayInline(rawValue),
    };
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    const parsed = tryParseJsonArray(trimmed);
    if (parsed) {
      return {
        pretty: formatPgArrayPretty(parsed),
        inline: formatPgArrayInline(parsed),
      };
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const converted = `{${trimmed.slice(1, -1)}}`;
      return {
        pretty: converted,
        inline: collapseWhitespace(converted),
      };
    }
    return {
      pretty: trimmed,
      inline: collapseWhitespace(trimmed),
    };
  }

  if (typeof rawValue === "object") {
    try {
      const compact = JSON.stringify(rawValue);
      const parsed = tryParseJsonArray(compact ?? "");
      if (parsed) {
        return {
          pretty: formatPgArrayPretty(parsed),
          inline: formatPgArrayInline(parsed),
        };
      }
      const pretty = JSON.stringify(rawValue, null, 2);
      return {
        pretty,
        inline: collapseWhitespace(pretty ?? ""),
      };
    } catch {
      const str = String(rawValue);
      return { pretty: str, inline: collapseWhitespace(str) };
    }
  }

  const str = String(rawValue);
  return { pretty: str, inline: collapseWhitespace(str) };
};

export const computeArrayStringsFromText = (
  text: string | null,
): { pretty: string | null; inline: string | null } => {
  if (text == null) return { pretty: null, inline: null };
  const trimmed = text.trim();
  if (!trimmed) return { pretty: "", inline: "" };

  const parsed = tryParseJsonArray(trimmed);
  if (parsed) {
    return {
      pretty: formatPgArrayPretty(parsed),
      inline: formatPgArrayInline(parsed),
    };
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const converted = `{${trimmed.slice(1, -1)}}`;
    return {
      pretty: converted,
      inline: collapseWhitespace(converted),
    };
  }

  return {
    pretty: trimmed,
    inline: collapseWhitespace(trimmed),
  };
};
