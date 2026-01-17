/**
 * Tool Call Card Component
 *
 * Displays tool calls with friendly names and formatted output.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolCallCardProps {
  toolName: string;
  friendlyName: string;
  status: "pending" | "success" | "error";
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  summary?: string;
}

export function ToolCallCard({
  toolName,
  friendlyName,
  status,
  input,
  output,
  error,
  summary,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const renderStatusIcon = () => {
    switch (status) {
      case "pending":
        return <Loader2 className="h-4 w-4 animate-spin" role="status" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" data-testid="success-icon" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" data-testid="error-icon" />;
    }
  };

  const renderSummary = () => {
    if (summary) return summary;

    switch (status) {
      case "pending":
        return `Executing ${friendlyName}...`;
      case "success":
        return `${friendlyName} completed`;
      case "error":
        return error || `${friendlyName} failed`;
    }
  };

  const canExpand = status !== "pending";

  return (
    <Card className={cn(
      "my-2",
      status === "error" && "border-red-200 bg-red-50/50",
      status === "success" && "border-green-200 bg-green-50/50"
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {renderStatusIcon()}
          <CardTitle className="text-sm font-medium">
            {friendlyName}
          </CardTitle>
        </div>
        {canExpand && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
            aria-label={isExpanded ? "Hide details" : "Show details"}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{renderSummary()}</p>

        {isExpanded && (
          <div
            data-testid="tool-details"
            className="mt-4 space-y-3"
          >
            {/* Input parameters */}
            {Object.keys(input).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Input
                </h4>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify(input, null, 2)}
                </pre>
              </div>
            )}

            {/* Output */}
            {status === "success" && output && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Output
                </h4>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify(output, null, 2)}
                </pre>
              </div>
            )}

            {/* Error details */}
            {status === "error" && error && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Error
                </h4>
                <pre className="text-xs bg-red-100 text-red-800 p-2 rounded overflow-x-auto">
                  {error}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
