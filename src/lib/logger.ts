type LogLevel = "debug" | "info" | "warn" | "error";

const isProd = import.meta.env.PROD;
const namespacePattern = /^[a-z0-9._-]+$/i;

function normalize(
  namespaceOrMessage: unknown,
  args: unknown[],
): { namespace: string; payload: unknown[] } {
  if (
    typeof namespaceOrMessage === "string" &&
    namespacePattern.test(namespaceOrMessage) &&
    args.length > 0
  ) {
    return { namespace: namespaceOrMessage, payload: args };
  }

  return {
    namespace: "app",
    payload: [namespaceOrMessage, ...args],
  };
}

function getCallerLocation(): string {
  const stack = new Error().stack;
  if (!stack) return "";

  const lines = stack.split("\n");
  // Skip first lines: Error, getCallerLocation, emit, logger.info/debug/etc
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Skip internal logger calls
    if (line.includes("logger.ts") || line.includes("logger.js")) continue;

    // Chrome: "    at functionName (http://host/path/file.ts:line:col)"
    // Safari: "functionName@http://host/path/file.ts:line:col"
    // Firefox: "functionName@http://host/path/file.ts:line:col"
    const chromeMatch = line.match(/at\s+(?:.*?\s+)?\(?(.+):(\d+):\d+\)?/);
    const safariMatch = line.match(/@(.+):(\d+):\d+$/);
    const match = chromeMatch ?? safariMatch;

    if (match?.[1] && match[2]) {
      let file = match[1];
      // Handle URLs and file paths
      if (file.includes("?")) file = file.split("?")[0] ?? file;
      file = file.split("/").pop() ?? file;
      return `(${file}:${match[2]})`;
    }
  }
  return "";
}

function emit(
  level: LogLevel,
  namespaceOrMessage: unknown,
  ...args: unknown[]
) {
  // Drop non-error logs in production to avoid disk I/O and noise
  if (isProd && level !== "error") return;

  const { namespace, payload } = normalize(namespaceOrMessage, args);
  const caller = getCallerLocation();
  const prefix = `[${namespace}]${caller ? ` ${caller}` : ""}`;
  const fn =
    level === "debug"
      ? console.debug
      : level === "info"
      ? console.info
      : level === "warn"
      ? console.warn
      : console.error;
  fn(prefix, ...payload);
}

export const logger = {
  debug: (namespaceOrMessage: unknown, ...args: unknown[]) =>
    emit("debug", namespaceOrMessage, ...args),
  info: (namespaceOrMessage: unknown, ...args: unknown[]) =>
    emit("info", namespaceOrMessage, ...args),
  warn: (namespaceOrMessage: unknown, ...args: unknown[]) =>
    emit("warn", namespaceOrMessage, ...args),
  error: (namespaceOrMessage: unknown, ...args: unknown[]) =>
    emit("error", namespaceOrMessage, ...args),
  group: (namespaceOrMessage: unknown, ...args: unknown[]) => {
    if (isProd) return;
    const { namespace, payload } = normalize(namespaceOrMessage, args);
    console.group(`[${namespace}]`, ...payload);
  },
  groupCollapsed: (namespaceOrMessage: unknown, ...args: unknown[]) => {
    if (isProd) return;
    const { namespace, payload } = normalize(namespaceOrMessage, args);
    console.groupCollapsed(`[${namespace}]`, ...payload);
  },
  groupEnd: () => {
    if (isProd) return;
    console.groupEnd();
  },
  table: (namespaceOrMessage: unknown, data: unknown) => {
    if (isProd) return;
    const { namespace } = normalize(namespaceOrMessage, []);
    console.table(data, [`[${namespace}]`]);
  },
};
