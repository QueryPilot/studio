/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export function formatInteger(value: number | unknown): string {
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString("en-US");
}

export function formatDecimal(value: number | unknown, scale?: number): string {
  const num = Number(value);
  if (isNaN(num)) return String(value);

  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: scale ?? 2,
    maximumFractionDigits: scale ?? 6,
  };

  return num.toLocaleString("en-US", options);
}

export function formatDate(value: string | unknown): string {
  try {
    const date = new Date(String(value));
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(value);
  }
}

export function formatDateTime(value: string | unknown): string {
  try {
    const date = new Date(String(value));
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function formatTime(value: string | unknown): string {
  try {
    const strValue = String(value);
    // If it's just a time string like "14:30:00"
    if (/^\d{2}:\d{2}(:\d{2})?/.test(strValue)) {
      return strValue;
    }
    // Otherwise try to parse as date and extract time
    const date = new Date(strValue);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function formatBytes(bytes: number): string {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = sizes[i] ?? "B";
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${size}`;
}
