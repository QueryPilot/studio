/**
 * Error handling utilities with actionable feedback
 * Provides structured errors with suggestions for resolution
 */

export interface ActionableError {
  code: string;
  message: string;
  suggestion: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
}

export enum ErrorCode {
  // Validation errors
  INVALID_PROMPT = "INVALID_PROMPT",
  INVALID_COLUMNS = "INVALID_COLUMNS",
  INVALID_CONNECTION = "INVALID_CONNECTION",
  INVALID_QUERY_TYPE = "INVALID_QUERY_TYPE",
  FORBIDDEN_KEYWORD = "FORBIDDEN_KEYWORD",

  // AI errors
  AI_GENERATION_FAILED = "AI_GENERATION_FAILED",
  AI_PARSING_FAILED = "AI_PARSING_FAILED",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_RATE_LIMITED = "AI_RATE_LIMITED",
  AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR",

  // Database errors
  DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED",
  DB_QUERY_FAILED = "DB_QUERY_FAILED",
  DB_TABLE_NOT_FOUND = "DB_TABLE_NOT_FOUND",
  DB_COLUMN_NOT_FOUND = "DB_COLUMN_NOT_FOUND",
  DB_PERMISSION_DENIED = "DB_PERMISSION_DENIED",

  // Tool errors
  TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TAURI_UNAVAILABLE = "TAURI_UNAVAILABLE",

  // System errors
  RATE_LIMITED = "RATE_LIMITED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
}

// Error definitions with suggestions
const ERROR_DEFINITIONS: Record<ErrorCode, { message: string; suggestion: string; recoverable: boolean }> = {
  [ErrorCode.INVALID_PROMPT]: {
    message: "The filter prompt is empty or invalid",
    suggestion: "Provide a natural language description of what you want to filter, e.g., 'active users created this week'",
    recoverable: true,
  },
  [ErrorCode.INVALID_COLUMNS]: {
    message: "No column metadata provided",
    suggestion: "Ensure the table has been loaded and column information is available",
    recoverable: true,
  },
  [ErrorCode.INVALID_CONNECTION]: {
    message: "Invalid or missing database connection",
    suggestion: "Check that a database connection is active and the connection ID is valid",
    recoverable: true,
  },
  [ErrorCode.INVALID_QUERY_TYPE]: {
    message: "Only SELECT queries are allowed",
    suggestion: "Use SELECT statements to read data. For data modification, use the appropriate UI tools",
    recoverable: true,
  },
  [ErrorCode.FORBIDDEN_KEYWORD]: {
    message: "Query contains forbidden SQL keywords",
    suggestion: "Remove INSERT, UPDATE, DELETE, DROP, or other modification keywords from your query",
    recoverable: true,
  },
  [ErrorCode.AI_GENERATION_FAILED]: {
    message: "AI failed to generate a valid SQL filter",
    suggestion: "Try rephrasing your request with more specific terms, or check if the column names match your intent",
    recoverable: true,
  },
  [ErrorCode.AI_PARSING_FAILED]: {
    message: "Could not parse the AI response into valid SQL",
    suggestion: "The AI response was unclear. Try a simpler filter description or use manual SQL mode",
    recoverable: true,
  },
  [ErrorCode.AI_TIMEOUT]: {
    message: "AI request timed out",
    suggestion: "The request took too long. Try again or simplify your query. Complex cross-table filters may take longer",
    recoverable: true,
  },
  [ErrorCode.AI_RATE_LIMITED]: {
    message: "AI service rate limit exceeded",
    suggestion: "Too many requests. Please wait a moment before trying again",
    recoverable: true,
  },
  [ErrorCode.AI_PROVIDER_ERROR]: {
    message: "AI provider returned an error",
    suggestion: "Check your API key configuration in Preferences. The AI service may be temporarily unavailable",
    recoverable: true,
  },
  [ErrorCode.DB_CONNECTION_FAILED]: {
    message: "Failed to connect to the database",
    suggestion: "Verify your connection settings and ensure the database server is accessible",
    recoverable: true,
  },
  [ErrorCode.DB_QUERY_FAILED]: {
    message: "Database query execution failed",
    suggestion: "Check the generated SQL for syntax errors. The table or column names may be incorrect",
    recoverable: true,
  },
  [ErrorCode.DB_TABLE_NOT_FOUND]: {
    message: "Table not found in the database",
    suggestion: "Verify the table name and schema. The table may have been renamed or deleted",
    recoverable: true,
  },
  [ErrorCode.DB_COLUMN_NOT_FOUND]: {
    message: "Column not found in the table",
    suggestion: "Check that the column exists. Column names are case-sensitive in some databases",
    recoverable: true,
  },
  [ErrorCode.DB_PERMISSION_DENIED]: {
    message: "Permission denied for database operation",
    suggestion: "Your database user may not have permission for this operation. Contact your DBA",
    recoverable: false,
  },
  [ErrorCode.TOOL_EXECUTION_FAILED]: {
    message: "Tool execution failed",
    suggestion: "An internal tool encountered an error. Try again or report the issue if it persists",
    recoverable: true,
  },
  [ErrorCode.TOOL_NOT_FOUND]: {
    message: "Requested tool not available",
    suggestion: "This feature may not be available for your database type",
    recoverable: false,
  },
  [ErrorCode.TAURI_UNAVAILABLE]: {
    message: "Cannot reach the application backend",
    suggestion: "Ensure the application is running properly. Try restarting if the issue persists",
    recoverable: true,
  },
  [ErrorCode.RATE_LIMITED]: {
    message: "Too many requests",
    suggestion: "Please wait before making more requests. Consider batching your operations",
    recoverable: true,
  },
  [ErrorCode.INTERNAL_ERROR]: {
    message: "An internal error occurred",
    suggestion: "Please try again. If the problem persists, report it with the error details",
    recoverable: true,
  },
  [ErrorCode.NETWORK_ERROR]: {
    message: "Network communication error",
    suggestion: "Check your network connection and try again",
    recoverable: true,
  },
};

/**
 * Create an actionable error with suggestion
 */
export function createError(
  code: ErrorCode,
  details?: Record<string, unknown>,
  overrideMessage?: string
): ActionableError {
  const definition = ERROR_DEFINITIONS[code];
  return {
    code,
    message: overrideMessage || definition.message,
    suggestion: definition.suggestion,
    details,
    recoverable: definition.recoverable,
  };
}

/**
 * Convert any error to an actionable error
 */
export function toActionableError(error: unknown): ActionableError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // AI provider errors
    if (message.includes("api key") || message.includes("unauthorized") || message.includes("401")) {
      return createError(ErrorCode.AI_PROVIDER_ERROR, { originalMessage: error.message });
    }
    if (message.includes("rate limit") || message.includes("429")) {
      return createError(ErrorCode.AI_RATE_LIMITED, { originalMessage: error.message });
    }
    if (message.includes("timeout") || message.includes("aborted")) {
      return createError(ErrorCode.AI_TIMEOUT, { originalMessage: error.message });
    }

    // Database errors
    if (message.includes("relation") && message.includes("does not exist")) {
      return createError(ErrorCode.DB_TABLE_NOT_FOUND, { originalMessage: error.message });
    }
    if (message.includes("column") && message.includes("does not exist")) {
      return createError(ErrorCode.DB_COLUMN_NOT_FOUND, { originalMessage: error.message });
    }
    if (message.includes("permission denied") || message.includes("access denied")) {
      return createError(ErrorCode.DB_PERMISSION_DENIED, { originalMessage: error.message });
    }
    if (message.includes("syntax error") || message.includes("near")) {
      return createError(ErrorCode.DB_QUERY_FAILED, { originalMessage: error.message });
    }

    // Network/Tauri errors
    if (message.includes("fetch") || message.includes("network") || message.includes("econnrefused")) {
      return createError(ErrorCode.NETWORK_ERROR, { originalMessage: error.message });
    }
    if (message.includes("tauri") || message.includes("cannot reach")) {
      return createError(ErrorCode.TAURI_UNAVAILABLE, { originalMessage: error.message });
    }

    // Generic fallback
    return createError(ErrorCode.INTERNAL_ERROR, { originalMessage: error.message }, error.message);
  }

  return createError(ErrorCode.INTERNAL_ERROR, { originalError: String(error) });
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: ActionableError): {
  error: string;
  code: string;
  suggestion: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
} {
  return {
    error: error.message,
    code: error.code,
    suggestion: error.suggestion,
    recoverable: error.recoverable,
    details: error.details,
  };
}

/**
 * Create a Response object from an actionable error
 */
export function errorResponse(
  error: ActionableError,
  corsHeaders: Record<string, string> = {}
): Response {
  const statusCode = getStatusCode(error.code);
  return new Response(JSON.stringify(formatErrorResponse(error)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function getStatusCode(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.INVALID_PROMPT:
    case ErrorCode.INVALID_COLUMNS:
    case ErrorCode.INVALID_CONNECTION:
    case ErrorCode.INVALID_QUERY_TYPE:
    case ErrorCode.FORBIDDEN_KEYWORD:
      return 400;

    case ErrorCode.DB_PERMISSION_DENIED:
      return 403;

    case ErrorCode.DB_TABLE_NOT_FOUND:
    case ErrorCode.DB_COLUMN_NOT_FOUND:
    case ErrorCode.TOOL_NOT_FOUND:
      return 404;

    case ErrorCode.RATE_LIMITED:
    case ErrorCode.AI_RATE_LIMITED:
      return 429;

    case ErrorCode.AI_TIMEOUT:
      return 408;

    case ErrorCode.AI_PROVIDER_ERROR:
      return 502;

    default:
      return 500;
  }
}
