type LogLevel = "debug" | "info" | "warn" | "error";

const isProd = import.meta.env.PROD;

function emit(level: LogLevel, namespace: string, ...args: unknown[]) {
  // Drop non-error logs in production to avoid disk I/O and noise
  if (isProd && level !== "error") return;

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
  debug: (namespace: string, ...args: unknown[]) =>
    emit("debug", namespace, ...args),
  info: (namespace: string, ...args: unknown[]) =>
    emit("info", namespace, ...args),
  warn: (namespace: string, ...args: unknown[]) =>
    emit("warn", namespace, ...args),
  error: (namespace: string, ...args: unknown[]) =>
    emit("error", namespace, ...args),
};
