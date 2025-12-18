import type { BitDisplayMode } from "./types";

/**
 * Validate a binary string (only 0s and 1s)
 */
export function isValidBinary(value: string): boolean {
  if (!value) return true;
  return /^[01]+$/.test(value);
}

/**
 * Validate binary string length for fixed-length BIT(n)
 */
export function isValidBitLength(value: string, expectedLength?: number): boolean {
  if (!value || !expectedLength) return true;
  return value.length === expectedLength;
}

/**
 * Convert binary string to hexadecimal
 */
export function binaryToHex(binary: string): string {
  if (!binary) return "";

  // Pad to multiple of 4 for clean hex conversion
  const paddedLength = Math.ceil(binary.length / 4) * 4;
  const padded = binary.padStart(paddedLength, "0");

  let hex = "";
  for (let i = 0; i < padded.length; i += 4) {
    const nibble = padded.substring(i, i + 4);
    hex += parseInt(nibble, 2).toString(16).toUpperCase();
  }

  return hex;
}

/**
 * Convert hexadecimal to binary string
 */
export function hexToBinary(hex: string): string {
  if (!hex) return "";

  let binary = "";
  for (const char of hex) {
    const value = parseInt(char, 16);
    if (isNaN(value)) return ""; // Invalid hex
    binary += value.toString(2).padStart(4, "0");
  }

  return binary;
}

/**
 * Convert binary string to decimal
 */
export function binaryToDecimal(binary: string): string {
  if (!binary) return "";

  // For very long binary strings, we need BigInt
  if (binary.length > 53) {
    try {
      return BigInt("0b" + binary).toString();
    } catch {
      return "overflow";
    }
  }

  return parseInt(binary, 2).toString();
}

/**
 * Convert decimal to binary string
 */
export function decimalToBinary(decimal: string): string {
  if (!decimal) return "";

  try {
    const num = BigInt(decimal);
    if (num < 0n) return ""; // Negative not supported
    return num.toString(2);
  } catch {
    return "";
  }
}

/**
 * Format binary string for display with grouping
 */
export function formatBinaryDisplay(binary: string, groupSize: number = 4): string {
  if (!binary) return "";

  const groups: string[] = [];
  for (let i = 0; i < binary.length; i += groupSize) {
    groups.push(binary.substring(i, i + groupSize));
  }

  return groups.join(" ");
}

/**
 * Get display value based on mode
 */
export function getDisplayValue(
  binary: string | null,
  mode: BitDisplayMode,
): string {
  if (!binary) return "NULL";

  switch (mode) {
    case "binary":
      return `B'${binary}'`;
    case "hex":
      return `X'${binaryToHex(binary)}'`;
    case "decimal":
      return binaryToDecimal(binary);
  }
}

/**
 * Parse input value based on mode
 */
export function parseInputValue(
  input: string,
  mode: BitDisplayMode,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  switch (mode) {
    case "binary":
      // Remove B' prefix and ' suffix if present
      let binary = trimmed;
      if (binary.toUpperCase().startsWith("B'") && binary.endsWith("'")) {
        binary = binary.slice(2, -1);
      }
      return isValidBinary(binary) ? binary : null;

    case "hex":
      // Remove X' prefix and ' suffix if present
      let hex = trimmed;
      if (hex.toUpperCase().startsWith("X'") && hex.endsWith("'")) {
        hex = hex.slice(2, -1);
      }
      // Remove 0x prefix if present
      if (hex.toLowerCase().startsWith("0x")) {
        hex = hex.slice(2);
      }
      return hexToBinary(hex) || null;

    case "decimal":
      return decimalToBinary(trimmed) || null;
  }
}

/**
 * Count bits set to 1
 */
export function countSetBits(binary: string): number {
  return (binary.match(/1/g) || []).length;
}

/**
 * Get bit at specific position (0-indexed from left)
 */
export function getBit(binary: string, position: number): boolean {
  if (position < 0 || position >= binary.length) return false;
  return binary[position] === "1";
}

/**
 * Toggle bit at specific position
 */
export function toggleBit(binary: string, position: number): string {
  if (position < 0 || position >= binary.length) return binary;

  const bits = binary.split("");
  bits[position] = bits[position] === "1" ? "0" : "1";
  return bits.join("");
}

