import { usePreferencesStore } from "@/stores/preferencesStore";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconInfoCircle, IconExternalLink, IconAlertCircle } from '@tabler/icons-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { disableSentry, configureTelemetryBackend } from "@/utils/sentry";
import { useState } from "react";
import { toast } from "sonner";

export default function TelemetryPanel() {
  const { telemetry, setTelemetry } = usePreferencesStore();
  const [needsRestart, setNeedsRestart] = useState(false);

  const handleCrashReportingToggle = async (checked: boolean) => {
    setTelemetry({ sentryEnabled: checked });

    if (!checked) {
      // Disable Sentry immediately when user opts out
      disableSentry();

      // Also disable backend and sidecar
      try {
        await configureTelemetryBackend(false);
        toast.success("Error tracking disabled", {
          description:
            "Sentry has been disabled immediately across all components. No more data will be sent.",
        });
      } catch (error) {
        console.error("Failed to disable backend telemetry:", error);
        toast.error("Failed to disable backend telemetry", {
          description:
            "Frontend tracking disabled, but backend may still be active.",
        });
      }
      setNeedsRestart(false);
    } else {
      // Enabling requires restart to initialize properly
      // Configure backend and sidecar now, but frontend needs restart
      try {
        await configureTelemetryBackend(true);
        setNeedsRestart(true);
        toast.info("Restart required", {
          description:
            "Backend telemetry configured. Please restart Query Pilot to enable frontend error tracking.",
          duration: 5000,
        });
      } catch (error) {
        console.error("Failed to enable backend telemetry:", error);
        toast.error("Failed to enable telemetry", {
          description: "Could not configure backend error tracking.",
        });
      }
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Telemetry & Error Reporting</h2>
        <p className="text-sm text-muted-foreground">
          Help us improve Query Pilot by sharing anonymous error reports and performance data.
        </p>
      </div>

      <Alert>
        <IconInfoCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Your privacy matters:</strong> All data is anonymized and we never collect queries,
          credentials, personal information, or user messages. Only error stack traces and performance
          metrics are sent.
        </AlertDescription>
      </Alert>

      {needsRestart && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20">
          <IconAlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertDescription>
            <strong>Restart required:</strong> Please restart Query Pilot for error tracking to take effect.
            You can continue using the app, but error tracking won't be active until you restart.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* Crash Reporting */}
        <div className="flex items-start justify-between gap-6 py-4 border-b">
          <div className="flex-1 space-y-1">
            <Label
              htmlFor="sentry-enabled"
              className="text-sm font-medium cursor-pointer"
            >
              Enable error tracking
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically send error reports when the app crashes. Helps us identify and fix bugs faster.
              {!telemetry.sentryEnabled && (
                <>
                  <br />
                  <strong className="text-yellow-600 dark:text-yellow-400">
                    Currently disabled:
                  </strong>{" "}
                  No error data is being collected or sent.
                </>
              )}
              {telemetry.sentryEnabled && (
                <>
                  <br />
                  <strong className="text-green-600 dark:text-green-400">
                    Active:
                  </strong>{" "}
                  Errors are being tracked. Disabling takes effect immediately.
                </>
              )}
            </p>
          </div>
          <Switch
            id="sentry-enabled"
            checked={telemetry.sentryEnabled}
            onCheckedChange={handleCrashReportingToggle}
          />
        </div>

        {/* Performance Monitoring */}
        <div className="flex items-start justify-between gap-6 py-4 border-b">
          <div className="flex-1 space-y-1">
            <Label
              htmlFor="performance-monitoring"
              className="text-sm font-medium cursor-pointer"
            >
              Performance monitoring
            </Label>
            <p className="text-xs text-muted-foreground">
              Track performance metrics to help us optimize app speed and responsiveness.
              Only 10% of operations are sampled.
            </p>
          </div>
          <Switch
            id="performance-monitoring"
            checked={telemetry.performanceMonitoring}
            onCheckedChange={(checked) =>
              setTelemetry({ performanceMonitoring: checked })
            }
            disabled={!telemetry.sentryEnabled}
          />
        </div>

        {/* Session Replay */}
        <div className="flex items-start justify-between gap-6 py-4 border-b">
          <div className="flex-1 space-y-1">
            <Label
              htmlFor="session-replay"
              className="text-sm font-medium cursor-pointer"
            >
              Session replay on errors
            </Label>
            <p className="text-xs text-muted-foreground">
              Record anonymized session replays when errors occur. All text and media are masked for privacy.
              Only 50% of errors are recorded.
            </p>
          </div>
          <Switch
            id="session-replay"
            checked={telemetry.sessionReplay}
            onCheckedChange={(checked) =>
              setTelemetry({ sessionReplay: checked })
            }
            disabled={!telemetry.sentryEnabled}
          />
        </div>
      </div>

      {/* What We Collect */}
      <div className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold">What data is collected?</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-medium text-green-600 dark:text-green-400 mb-2">
              ✓ Data we collect
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Error stack traces</li>
              <li>• App version & OS info</li>
              <li>• Operation types (anonymized)</li>
              <li>• Performance metrics</li>
              <li>• IconDatabase adapter types</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">
              ✗ Data we never collect
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• SQL queries or content</li>
              <li>• API keys or credentials</li>
              <li>• IconDatabase connection strings</li>
              <li>• AI chat messages or responses</li>
              <li>• Personal user information</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="flex items-center gap-4 pt-4 text-xs">
        <a
          href="https://query-pilot.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline flex items-center gap-1"
        >
          Privacy Policy
          <IconExternalLink className="h-3 w-3" />
        </a>
        <span className="text-muted-foreground">•</span>
        <a
          href="https://sentry.io/privacy/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline flex items-center gap-1"
        >
          Sentry Privacy
          <IconExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
