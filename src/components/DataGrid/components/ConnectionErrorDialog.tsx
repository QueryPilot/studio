import { memo, useEffect } from "react";
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface ConnectionErrorDialogProps {
  isOpen: boolean;
  error: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const ConnectionErrorDialog = memo(function ConnectionErrorDialog({
  isOpen,
  error,
  onRetry,
  onDismiss,
}: ConnectionErrorDialogProps) {
  const navigate = useNavigate();

  // Parse the error to determine the type
  const isConnectionClosed =
    error?.toLowerCase().includes("closed pool") ||
    error?.toLowerCase().includes("connection lost") ||
    error?.toLowerCase().includes("connection timeout") ||
    error?.toLowerCase().includes("connection not found") ||
    error?.toLowerCase().includes("table data read failed");

  const isPermissionError =
    error?.toLowerCase().includes("permission denied") ||
    error?.toLowerCase().includes("access denied");

  const handleReconnect = () => {
    // Navigate back to connections screen
    navigate("/");
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    }
  };

  const handleDismiss = () => {
    if (onDismiss) {
      onDismiss();
    }
  };

  // Auto-dismiss non-critical errors after 5 seconds
  useEffect(() => {
    if (isOpen && !isConnectionClosed && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, 5000);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [isOpen, isConnectionClosed, onDismiss]);

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            {isConnectionClosed ? (
              <WifiOff className="h-5 w-5 text-destructive" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            <AlertDialogTitle>
              {isConnectionClosed
                ? "Database Connection Lost"
                : "Database Error"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="mt-2">
            {isConnectionClosed ? (
              <div className="space-y-2">
                <p>The connection to the database has been lost or closed.</p>
                <p className="text-xs text-muted-foreground">
                  This can happen due to network issues, server restart, or
                  connection timeout.
                </p>
              </div>
            ) : isPermissionError ? (
              <div className="space-y-2">
                <p>You don't have permission to perform this operation.</p>
                <p className="text-xs text-muted-foreground">
                  Please check your database user permissions.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>An error occurred while accessing the database:</p>
                <p className="text-xs font-mono bg-muted p-2 rounded select-text">
                  {error}
                </p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {isConnectionClosed ? (
            <>
              <Button variant="outline" onClick={handleReconnect}>
                Go to Connections
              </Button>
              {onRetry && (
                <Button onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reconnect
                </Button>
              )}
            </>
          ) : (
            <>
              {onDismiss && (
                <Button variant="outline" onClick={handleDismiss}>
                  Dismiss
                </Button>
              )}
              {onRetry && (
                <Button onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              )}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
