import React from "react";

interface ERDVisualizerPlaceholderProps {
  loading?: boolean;
  error?: string | null;
  tableCount?: number;
  relationshipCount?: number;
  schema?: string;
}

export const ERDVisualizerPlaceholder: React.FC<
  ERDVisualizerPlaceholderProps
> = ({
  loading,
  error,
  tableCount = 0,
  relationshipCount = 0,
  schema = "public",
}) => {
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <div className="text-center">
          <p className="text-xs font-medium text-foreground">
            Loading schema...
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Fetching tables for schema "{schema}"
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
        <div className="rounded-full bg-destructive/10 p-3">
          <svg
            className="h-6 w-6 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <p className="text-xs font-semibold text-foreground mb-2">
            Unable to load ERD
          </p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {error}
          </pre>
        </div>
      </div>
    );
  }

  if (tableCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
        <div className="rounded-full bg-muted p-3">
          <svg
            className="h-6 w-6 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xs font-medium text-foreground mb-1">
            No tables found
          </p>
          <p className="text-xs text-muted-foreground">
            Schema "{schema}" is empty or contains no tables
          </p>
        </div>
      </div>
    );
  }

  // This shouldn't happen anymore since we render the ERDVisualizer when we have tables
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
      <p className="text-xs font-medium">Ready to visualize</p>
      <p className="text-xs max-w-xs leading-relaxed">
        {tableCount} table{tableCount === 1 ? "" : "s"} with {relationshipCount}{" "}
        relationship
        {relationshipCount === 1 ? "" : "s"} loaded
      </p>
    </div>
  );
};
