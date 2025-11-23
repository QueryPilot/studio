import React from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { Button } from "@/components/ui/button";

interface FeatureErrorBoundaryProps {
  children: React.ReactNode;
  featureName: string;
  onReset?: () => void;
}

/**
 * Feature-level error boundary for isolated error handling
 * Use this to wrap individual features/panels so errors don't crash the entire app
 */
export function FeatureErrorBoundary({
  children,
  featureName,
  onReset,
}: FeatureErrorBoundaryProps) {
  return (
    <ErrorBoundary
      onReset={onReset}
      fallback={
        <div className="flex items-center justify-center h-full min-h-[200px] bg-muted/10 rounded-xl border border-border">
          <div className="max-w-md w-full p-6 space-y-4 text-center">
            <div className="flex justify-center">
              <IconAlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {featureName} Error
              </h3>
              <p className="text-xs text-muted-foreground">
                This feature encountered an error. Other parts of the
                application should still work.
              </p>
            </div>
            <Button
              onClick={() => {
                onReset?.();
                window.location.reload();
              }}
              variant="outline"
              size="sm"
            >
              <IconRefresh className="h-4 w-4 mr-2" />
              Reload Application
            </Button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
