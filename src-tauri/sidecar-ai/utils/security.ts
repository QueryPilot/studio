/**
 * Security utilities for preventing prompt injection and other attacks
 */

/**
 * Sanitize user input to prevent prompt injection attacks
 * Removes newlines, control characters, and suspicious patterns
 */
export function sanitizeInput(input: string | null): string {
  if (!input) return "";

  // Remove all control characters including newlines, tabs, etc.
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, "");

  // Remove common prompt injection patterns
  sanitized = sanitized.replace(/```/g, ""); // Remove code block markers
  sanitized = sanitized.replace(/---/g, ""); // Remove markdown separators

  // Trim whitespace
  sanitized = sanitized.trim();

  // Limit length to prevent extremely long inputs
  const MAX_LENGTH = 256;
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Validate connection ID format
 * Should be a UUID or alphanumeric string
 */
export function validateConnectionId(connId: string): boolean {
  if (!connId) return false;

  // Allow UUID format or alphanumeric with hyphens/underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(connId) && connId.length <= 128;
}

/**
 * Validate database/schema name
 * Should only contain safe SQL identifier characters
 */
export function validateIdentifier(identifier: string): boolean {
  if (!identifier) return false;

  // Allow alphanumeric, underscores, and dots (for schemas like "dbo.table")
  // No spaces, quotes, semicolons, or other SQL injection characters
  const validPattern = /^[a-zA-Z0-9_.]+$/;
  return validPattern.test(identifier) && identifier.length <= 128;
}

/**
 * Escape special characters for safe inclusion in prompts
 */
export function escapeForPrompt(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/"/g, '\\"') // Escape quotes
    .replace(/'/g, "\\'"); // Escape single quotes
}

/**
 * Comprehensive validation for connection context headers
 */
export function validateConnectionContext(context: {
  connectionId: string;
  database: string;
  schema: string;
}): {
  isValid: boolean;
  sanitized: {
    connectionId: string;
    database: string;
    schema: string;
  };
  errors: string[];
} {
  const errors: string[] = [];
  const sanitized = {
    connectionId: sanitizeInput(context.connectionId),
    database: sanitizeInput(context.database),
    schema: sanitizeInput(context.schema),
  };

  // Validate connection ID
  if (sanitized.connectionId && !validateConnectionId(sanitized.connectionId)) {
    errors.push("Invalid connection ID format");
    sanitized.connectionId = "";
  }

  // Validate database name
  if (sanitized.database && !validateIdentifier(sanitized.database)) {
    errors.push("Invalid database name format");
    sanitized.database = "";
  }

  // Validate schema name
  if (sanitized.schema && !validateIdentifier(sanitized.schema)) {
    errors.push("Invalid schema name format");
    sanitized.schema = "";
  }

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
  };
}
