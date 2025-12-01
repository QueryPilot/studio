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

function emit(
  level: LogLevel,
  namespaceOrMessage: unknown,
  ...args: unknown[]
) {
  // Drop non-error logs in production to avoid disk I/O and noise
  if (isProd && level !== "error") return;

  const { namespace } = normalize(namespaceOrMessage, args);
  const prefix = `[${namespace}]`;
  const fn =
    level === "debug"
      ? console.debug
      : level === "info"
      ? console.info
      : level === "warn"
      ? console.warn
      : console.error;
  fn(prefix, ...args);
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
