/**
 * Network address validation utilities for INET, CIDR, and MACADDR types
 */

// IPv4 address pattern: 0.0.0.0 - 255.255.255.255
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// IPv4 with CIDR notation: x.x.x.x/0-32
const IPV4_CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

// IPv6 address pattern (simplified - covers most common formats)
const IPV6_PATTERN = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

// IPv6 with CIDR notation
const IPV6_CIDR_PATTERN = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\/(\d{1,3})$/;

// MAC address patterns (6 octets with : or - separators)
const MAC_COLON_PATTERN = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const MAC_DASH_PATTERN = /^([0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}$/;

// MACADDR8 patterns (8 octets)
const MAC8_COLON_PATTERN = /^([0-9A-Fa-f]{2}:){7}[0-9A-Fa-f]{2}$/;
const MAC8_DASH_PATTERN = /^([0-9A-Fa-f]{2}-){7}[0-9A-Fa-f]{2}$/;

/**
 * Validate an IPv4 address
 */
export function isValidIPv4(ip: string): boolean {
  const match = ip.match(IPV4_PATTERN);
  if (!match) return false;
  
  // Check each octet is 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) return false;
  }
  return true;
}

/**
 * Validate an IPv4 address with CIDR notation
 */
export function isValidIPv4Cidr(ip: string): boolean {
  const match = ip.match(IPV4_CIDR_PATTERN);
  if (!match) return false;
  
  // Check each octet is 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) return false;
  }
  
  // Check CIDR prefix is 0-32
  const prefix = parseInt(match[5], 10);
  return prefix >= 0 && prefix <= 32;
}

/**
 * Validate an IPv6 address (simplified validation)
 */
export function isValidIPv6(ip: string): boolean {
  // Handle :: shorthand
  if (ip === "::") return true;
  
  // Check basic pattern
  if (!IPV6_PATTERN.test(ip)) return false;
  
  // Count colons to ensure valid format
  const colons = (ip.match(/:/g) || []).length;
  const doubleColons = (ip.match(/::/g) || []).length;
  
  if (doubleColons > 1) return false;
  if (doubleColons === 0 && colons !== 7) return false;
  
  return true;
}

/**
 * Validate an IPv6 address with CIDR notation
 */
export function isValidIPv6Cidr(ip: string): boolean {
  const parts = ip.split("/");
  if (parts.length !== 2) return false;
  
  if (!isValidIPv6(parts[0])) return false;
  
  const prefix = parseInt(parts[1], 10);
  return !isNaN(prefix) && prefix >= 0 && prefix <= 128;
}

/**
 * Validate an INET or CIDR address (IPv4 or IPv6, with or without prefix)
 */
export function isValidInet(value: string): boolean {
  if (!value || value.trim() === "") return false;
  
  const trimmed = value.trim();
  
  // Check if it has CIDR notation
  if (trimmed.includes("/")) {
    return isValidIPv4Cidr(trimmed) || isValidIPv6Cidr(trimmed);
  }
  
  // Plain IP address
  return isValidIPv4(trimmed) || isValidIPv6(trimmed);
}

/**
 * Validate a MAC address (6 or 8 octets)
 */
export function isValidMacAddr(value: string): boolean {
  if (!value || value.trim() === "") return false;
  
  const trimmed = value.trim();
  
  // 6-octet MAC address
  if (MAC_COLON_PATTERN.test(trimmed) || MAC_DASH_PATTERN.test(trimmed)) {
    return true;
  }
  
  // 8-octet MAC address (MACADDR8)
  if (MAC8_COLON_PATTERN.test(trimmed) || MAC8_DASH_PATTERN.test(trimmed)) {
    return true;
  }
  
  return false;
}

/**
 * Format a MAC address with colons (normalize from dashes)
 */
export function formatMacAddr(value: string): string {
  if (!value) return value;
  
  // Replace dashes with colons
  return value.trim().replace(/-/g, ":").toUpperCase();
}

/**
 * Auto-format MAC address input (add colons automatically)
 */
export function autoFormatMacInput(value: string, previousValue: string): string {
  // Remove all non-hex characters except colons
  const cleaned = value.replace(/[^0-9A-Fa-f:]/g, "").toUpperCase();
  
  // If user is deleting, don't auto-format
  if (cleaned.length < previousValue.replace(/:/g, "").length) {
    return cleaned;
  }
  
  // Remove existing colons to get raw hex
  const hex = cleaned.replace(/:/g, "");
  
  // Insert colons every 2 characters
  const pairs: string[] = [];
  for (let i = 0; i < hex.length && i < 16; i += 2) {
    pairs.push(hex.substring(i, Math.min(i + 2, hex.length)));
  }
  
  return pairs.join(":");
}

/**
 * Parse CIDR notation into IP and prefix
 */
export function parseCidr(value: string): { ip: string; prefix: number | null } {
  if (!value) return { ip: "", prefix: null };
  
  const parts = value.trim().split("/");
  return {
    ip: parts[0] || "",
    prefix: parts[1] ? parseInt(parts[1], 10) : null,
  };
}

/**
 * Get the maximum CIDR prefix for an IP type
 */
export function getMaxPrefix(ip: string): number {
  if (isValidIPv4(ip) || isValidIPv4Cidr(ip)) {
    return 32;
  }
  return 128; // IPv6
}

/**
 * Determine if an IP address is IPv4 or IPv6
 */
export function getIpVersion(ip: string): 4 | 6 | null {
  const cleanIp = ip.split("/")[0];
  if (isValidIPv4(cleanIp)) return 4;
  if (isValidIPv6(cleanIp)) return 6;
  return null;
}

