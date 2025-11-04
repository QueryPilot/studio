import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw, Home, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    this.props.onReset?.();
  };

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
      await navigator.clipboard.writeText(errorText);
      this.setState({ copied: true });
      toast.success("Error details copied to clipboard");
      setTimeout(() => {
        this.setState({ copied: false });
      }, 2000);
    } catch (err) {
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
              <div className="flex-shrink-0">
                <AlertCircle className="h-10 w-10 text-destructive" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">
                    Something went wrong
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    An unexpected error occurred. You can try to recover or
                    reload the application.
                  </p>
                </div>

                {this.state.error && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                    <p className="text-sm font-semibold text-destructive mb-2">
                      Error Details:
                    </p>
                    <div className="max-h-32 overflow-y-auto overflow-x-hidden">
                      <pre className="text-xs text-destructive/90 font-mono whitespace-pre-wrap break-words">
                        {this.state.error.message}
                      </pre>
                    </div>
                    {process.env.NODE_ENV === "development" &&
                      this.state.errorInfo && (
                        <details className="mt-3">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Stack trace (development only)
                          </summary>
                          <pre className="text-xs text-muted-foreground font-mono mt-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                            {this.state.errorInfo.componentStack}
                          </pre>
                        </details>
                      )}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={this.handleReload} variant="default">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reload App
                  </Button>
                  <Button onClick={this.handleCopyError} variant="outline">
                    {this.state.copied ? (
                      <Check className="h-4 w-4 mr-2" />
                    ) : (
                      <Copy className="h-4 w-4 mr-2" />
                    )}
                    {this.state.copied ? "Copied!" : "Copy Error"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground pt-2">
                  If this problem persists, please report it at{" "}
                  <a
                    href="https://github.com/query-pilot/query-pilot-releases/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    GitHub Issues
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
