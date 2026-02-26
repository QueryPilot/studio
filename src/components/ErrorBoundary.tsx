import { logger } from "@/lib/logger";
import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  IconAlertCircle,
  IconRefresh,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { captureException } from "@/utils/sentry";
import { writeClipboardText } from "@/lib/clipboard";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("[ErrorBoundary] Uncaught error:", error, errorInfo);

    // Send error to Sentry if enabled
    captureException(error, {
      operation: "react-error-boundary",
      componentStack: errorInfo.componentStack,
    });

    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyError = async () => {
    const errorText = `Error: ${this.state.error?.message || "Unknown error"}${
      this.state.errorInfo
        ? `\n\nComponent Stack:\n${this.state.errorInfo.componentStack}`
        : ""
    }`;

    try {
      await writeClipboardText(errorText);
      this.setState({ copied: true });
      setTimeout(() => {
        this.setState({ copied: false });
      }, 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
          <div className="max-w-2xl w-full space-y-6">
            <div className="flex items-start space-x-4">
              <div className="shrink-0">
                <IconAlertCircle className="h-10 w-10 text-destructive" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">
                    Something went wrong
                  </h1>
                  <p className="text-xs text-muted-foreground mt-1">
                    An unexpected error occurred. You can try to recover or
                    reload the application.
                  </p>
                </div>

                {this.state.error && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 select-text">
                    {process.env.NODE_ENV === "production" ? (
                      // Production: Show minimal user-friendly message
                      <>
                        <p className="text-xs font-semibold text-destructive mb-2">
                          Error:
                        </p>
                        <p className="text-xs text-destructive/90">
                          The application encountered an unexpected error.
                          Please try reloading the app.
                        </p>
                        <p className="text-xs text-muted-foreground mt-3">
                          If error tracking is enabled in Preferences, this
                          error has been automatically reported to help us fix
                          the issue.
                        </p>
                      </>
                    ) : (
                      // Development: Show detailed error information
                      <>
                        <p className="text-xs font-semibold text-destructive mb-2">
                          Error Details:
                        </p>
                        <div className="max-h-32 overflow-y-auto overflow-x-hidden">
                          <pre className="text-xs text-destructive/90 font-mono whitespace-pre-wrap break-words">
                            {this.state.error.message}
                          </pre>
                        </div>
                        {this.state.error.stack && (
                          <details className="mt-3">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Error stack trace
                            </summary>
                            <pre className="text-xs text-muted-foreground font-mono mt-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                              {this.state.error.stack}
                            </pre>
                          </details>
                        )}
                        {this.state.errorInfo && (
                          <details className="mt-3">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Component stack trace
                            </summary>
                            <pre className="text-xs text-muted-foreground font-mono mt-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                              {this.state.errorInfo.componentStack}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={this.handleReload} variant="default">
                    <IconRefresh className="h-4 w-4 mr-2" />
                    Reload App
                  </Button>
                  {process.env.NODE_ENV === "development" && (
                    <Button onClick={this.handleCopyError} variant="outline">
                      {this.state.copied ? (
                        <IconCheck className="h-4 w-4 mr-2" />
                      ) : (
                        <IconCopy className="h-4 w-4 mr-2" />
                      )}
                      {this.state.copied ? "Copied!" : "Copy Error"}
                    </Button>
                  )}
                </div>

                {process.env.NODE_ENV === "production" && (
                  <p className="text-xs text-muted-foreground pt-2">
                    If this problem persists, please report it at{" "}
                    <a
                      href="https://github.com/QueryPilot/app/issues"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      GitHub Issues
                    </a>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
