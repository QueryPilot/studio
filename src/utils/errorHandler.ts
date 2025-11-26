import { logger } from "@/lib/logger";
import { toast } from "sonner";

// Error codes from the Rust backend
export enum ErrorCode {
  // Connection errors
  E_CONNECTION_NOT_FOUND = "E_CONNECTION_NOT_FOUND",
  E_CONNECTION_FAILED = "E_CONNECTION_FAILED",
  E_CONNECTION_POOL_FULL = "E_CONNECTION_POOL_FULL",
  E_CONNECTION_TIMEOUT = "E_CONNECTION_TIMEOUT",
  E_INVALID_CONNECTION_ID = "E_INVALID_CONNECTION_ID",
  
  // Query errors
  E_QUERY_FAILED = "E_QUERY_FAILED",
  E_QUERY_TIMEOUT = "E_QUERY_TIMEOUT",
  E_QUERY_CANCELLED = "E_QUERY_CANCELLED",
  E_INVALID_SQL = "E_INVALID_SQL",
  E_TRANSACTION_FAILED = "E_TRANSACTION_FAILED",
  
  // Introspection errors
  E_INTROSPECTION_FAILED = "E_INTROSPECTION_FAILED",
  E_SCHEMA_NOT_FOUND = "E_SCHEMA_NOT_FOUND",
  E_TABLE_NOT_FOUND = "E_TABLE_NOT_FOUND",
  E_COLUMN_NOT_FOUND = "E_COLUMN_NOT_FOUND",
  
  // Authentication errors
  E_AUTH_FAILED = "E_AUTH_FAILED",
  E_INSUFFICIENT_PRIVILEGES = "E_INSUFFICIENT_PRIVILEGES",
  E_ACCESS_DENIED = "E_ACCESS_DENIED",
  
  // Data errors
  E_DATA_TYPE_MISMATCH = "E_DATA_TYPE_MISMATCH",
  E_CONSTRAINT_VIOLATION = "E_CONSTRAINT_VIOLATION",
  E_DUPLICATE_KEY = "E_DUPLICATE_KEY",
  E_FOREIGN_KEY_VIOLATION = "E_FOREIGN_KEY_VIOLATION",
  E_NOT_NULL_VIOLATION = "E_NOT_NULL_VIOLATION",
  
  // Storage errors
  E_STORAGE_ERROR = "E_STORAGE_ERROR",
  E_CREDENTIAL_STORAGE_ERROR = "E_CREDENTIAL_STORAGE_ERROR",
  E_ENCRYPTION_ERROR = "E_ENCRYPTION_ERROR",
  E_DECRYPTION_ERROR = "E_DECRYPTION_ERROR",
  
  // Resource errors
  E_OUT_OF_MEMORY = "E_OUT_OF_MEMORY",
  E_RESOURCE_EXHAUSTED = "E_RESOURCE_EXHAUSTED",
  E_TOO_MANY_CONNECTIONS = "E_TOO_MANY_CONNECTIONS",
  
  // Generic errors
  E_INTERNAL_ERROR = "E_INTERNAL_ERROR",
  E_NOT_IMPLEMENTED = "E_NOT_IMPLEMENTED",
  E_INVALID_OPERATION = "E_INVALID_OPERATION",
  E_UNKNOWN_ERROR = "E_UNKNOWN_ERROR",
}

export interface BackendError {
  code: string;
  message: string;
  details?: string;
  context?: Record<string, any>;
}

export interface ErrorDisplay {
  title: string;
  description: string;
  variant: "default" | "destructive";
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Map error codes to user-friendly messages and actions
 */
const errorMappings: Partial<Record<ErrorCode, (error: BackendError) => ErrorDisplay>> = {
  [ErrorCode.E_CONNECTION_NOT_FOUND]: () => ({
    title: "Connection Not Found",
    description: "The database connection could not be found. It may have been deleted or expired.",
    variant: "destructive",
  }),

  [ErrorCode.E_CONNECTION_FAILED]: () => ({
    title: "Connection Failed",
    description: "Failed to connect to the database. Please check your connection settings and try again.",
    variant: "destructive",
    action: {
      label: "Edit Connection",
      onClick: () => {
        // Navigate to connection settings
        window.location.hash = "#/connections";
      },
    },
  }),

  [ErrorCode.E_CONNECTION_TIMEOUT]: () => ({
    title: "Connection Timeout",
    description: "The database connection timed out. The server may be slow or unreachable.",
    variant: "destructive",
    action: {
      label: "Retry",
      onClick: () => { window.location.reload(); },
    },
  }),

  [ErrorCode.E_QUERY_TIMEOUT]: () => ({
    title: "Query Timeout",
    description: "The query took too long to execute. Consider optimizing the query or increasing the timeout.",
    variant: "destructive",
  }),

  [ErrorCode.E_QUERY_CANCELLED]: () => ({
    title: "Query Cancelled",
    description: "The query was cancelled by user request.",
    variant: "default",
  }),

  [ErrorCode.E_INVALID_SQL]: () => ({
    title: "Invalid SQL",
    description: "The SQL syntax is invalid. Please check your query.",
    variant: "destructive",
  }),

  [ErrorCode.E_AUTH_FAILED]: () => ({
    title: "Authentication Failed",
    description: "Invalid username or password. Please check your credentials.",
    variant: "destructive",
    action: {
      label: "Update Credentials",
      onClick: () => {
        // Navigate to connection settings
        window.location.hash = "#/connections";
      },
    },
  }),

  [ErrorCode.E_INSUFFICIENT_PRIVILEGES]: () => ({
    title: "Insufficient Privileges",
    description: "You don't have permission to perform this operation.",
    variant: "destructive",
  }),

  [ErrorCode.E_DUPLICATE_KEY]: () => ({
    title: "Duplicate Key",
    description: "A record with this key already exists.",
    variant: "destructive",
  }),

  [ErrorCode.E_FOREIGN_KEY_VIOLATION]: () => ({
    title: "Foreign Key Violation",
    description: "This operation would violate a foreign key constraint.",
    variant: "destructive",
  }),

  [ErrorCode.E_NOT_NULL_VIOLATION]: () => ({
    title: "Required Field Missing",
    description: "A required field cannot be empty.",
    variant: "destructive",
  }),

  [ErrorCode.E_STORAGE_ERROR]: () => ({
    title: "Storage Error",
    description: "Failed to save data. Please check your disk space and permissions.",
    variant: "destructive",
  }),

  [ErrorCode.E_OUT_OF_MEMORY]: () => ({
    title: "Out of Memory",
    description: "The operation ran out of memory. Try reducing the data size or closing other applications.",
    variant: "destructive",
  }),

  [ErrorCode.E_TOO_MANY_CONNECTIONS]: () => ({
    title: "Too Many Connections",
    description: "Maximum number of database connections reached. Please close some connections and try again.",
    variant: "destructive",
  }),
};

/**
 * Handle backend errors and show appropriate user feedback
 */
export function handleBackendError(error: unknown): void {
  let errorDisplay: ErrorDisplay;

  if (isBackendError(error)) {
    const handler = errorMappings[error.code as ErrorCode];
    if (handler) {
      errorDisplay = handler(error);
    } else {
      // Fallback for unknown error codes
      errorDisplay = {
        title: "Database Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      };
    }
  } else if (error instanceof Error) {
    errorDisplay = {
      title: "Error",
      description: error.message,
      variant: "destructive",
    };
  } else {
    errorDisplay = {
      title: "Unknown Error",
      description: "An unexpected error occurred. Please try again.",
      variant: "destructive",
    };
  }

  // Show toast notification
  if (errorDisplay.variant === "destructive") {
    toast.error(errorDisplay.title, {
      description: errorDisplay.description,
    });
  } else {
    toast(errorDisplay.title, {
      description: errorDisplay.description,
    });
  }

  // Log error for debugging
  logger.error("Backend error:", error);
}

/**
 * Type guard to check if an error is a BackendError
 */
export function isBackendError(error: unknown): error is BackendError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as any).code === "string"
  );
}

/**
 * Extract error details from various error types
 */
export function extractErrorDetails(error: unknown): {
  code: string;
  message: string;
  details?: string;
} {
  if (isBackendError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: ErrorCode.E_UNKNOWN_ERROR,
      message: error.message,
      details: error.stack,
    };
  }

  return {
    code: ErrorCode.E_UNKNOWN_ERROR,
    message: String(error),
  };
}

/**
 * Format error for display in UI
 */
export function formatErrorForDisplay(error: unknown): string {
  const details = extractErrorDetails(error);
  
  if (details.details) {
    return `${details.message}\n\nDetails: ${details.details}`;
  }
  
  return details.message;
}

/**
 * Create a retry handler with exponential backoff
 */
export function createRetryHandler<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): () => Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = (error) => {
      const details = extractErrorDetails(error);
      return [
        ErrorCode.E_CONNECTION_TIMEOUT,
        ErrorCode.E_CONNECTION_FAILED,
        ErrorCode.E_RESOURCE_EXHAUSTED,
      ].includes(details.code as ErrorCode);
    },
  } = options;

  return async () => {
    let lastError: unknown;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Exponential backoff
        delay = Math.min(delay * 2, maxDelay);
      }
    }

    throw lastError;
  };
}