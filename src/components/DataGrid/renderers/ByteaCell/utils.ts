/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/**
 * Decode base64 to byte array
 */
export function base64ToBytes(base64: string): Uint8Array {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Encode byte array to base64
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binaryString);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/\s/g, "");
  if (cleanHex.length % 2 !== 0) return new Uint8Array(0);

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substring(i, i + 2), 16);
    if (isNaN(byte)) return new Uint8Array(0);
    bytes[i / 2] = byte;
  }
  return bytes;
}

/**
 * Convert bytes to ASCII string (with dots for non-printable)
 */
export function bytesToAscii(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
    .join("");
}

/**
 * Format hex dump with offset, hex, and ASCII columns
 */
export function formatHexDump(
  bytes: Uint8Array,
  bytesPerLine: number = 16,
): string[] {
  const lines: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
    const chunk = bytes.slice(offset, offset + bytesPerLine);

    // Offset column
    const offsetStr = offset.toString(16).padStart(8, "0");

    // Hex column
    const hexParts: string[] = [];
    for (let i = 0; i < bytesPerLine; i++) {
      if (i < chunk.length) {
        hexParts.push((chunk[i] ?? 0).toString(16).padStart(2, "0"));
      } else {
        hexParts.push("  ");
      }
    }
    const hexStr = hexParts.join(" ");

    // ASCII column
    const asciiStr = bytesToAscii(chunk);

    lines.push(`${offsetStr}  ${hexStr}  |${asciiStr}|`);
  }

  return lines;
}

/**
 * Get preview text for bytea data
 */
export function getByteaPreview(base64: string | null): string {
  if (!base64) return "NULL";

  try {
    const bytes = base64ToBytes(base64);
    const size = formatFileSize(bytes.length);
    return `[BINARY: ${size}]`;
  } catch {
    return "[BINARY: ?]";
  }
}

/**
 * Validate base64 string
 */
export function isValidBase64(str: string): boolean {
  if (!str) return true;

  try {
    // Check if it's valid base64
    const decoded = atob(str);
    const reencoded = btoa(decoded);
    return reencoded === str;
  } catch {
    return false;
  }
}

/**
 * Validate hex string
 */
export function isValidHex(str: string): boolean {
  if (!str) return true;
  const cleanHex = str.replace(/\s/g, "");
  return /^[0-9A-Fa-f]*$/.test(cleanHex) && cleanHex.length % 2 === 0;
}

/**
 * Read file as base64
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Download bytes as file
 */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Parse PostgreSQL hstore from binary format
 */
export function parseHstoreFromBytes(bytes: Uint8Array): Record<string, string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Record<string, string | null> = {};
  let offset = 0;

  const count = view.getInt32(offset, false);
  offset += 4;

  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < count; i++) {
    const keyLen = view.getInt32(offset, false);
    offset += 4;
    const key = decoder.decode(bytes.subarray(offset, offset + keyLen));
    offset += keyLen;

    const valLen = view.getInt32(offset, false);
    offset += 4;
    if (valLen === -1) {
      result[key] = null;
    } else {
      result[key] = decoder.decode(bytes.subarray(offset, offset + valLen));
      offset += valLen;
    }
  }

  return result;
}

export function formatHstore(hstore: Record<string, string | null>): string {
  return Object.entries(hstore)
    .map(([k, v]) => `"${k}"=>${v === null ? 'NULL' : `"${v}"`}`)
    .join(', ');
}

