import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  IconCheck,
  IconCopy,
  IconX,
  IconRefresh,
  IconLoader2,
  IconExternalLink,
  IconDownload,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { detectPlatform, type RuntimePlatform } from "@/lib/platform";

// ============================================================================
// Types
// ============================================================================

type DriverStatus = "idle" | "checking" | "installed" | "missing" | "error";
type InstallStatus = "idle" | "installing" | "success" | "error";

interface InstallMethod {
  label: string;
  command: string;
  notes?: string;
  platforms: RuntimePlatform[];
  /** If true, the command can be executed via the Install button */
  executable?: boolean;
  /** brew package name for executable methods */
  brewPackage?: string;
}

interface DriverConfig {
  name: string;
  description: string;
  installMethods: InstallMethod[];
  learnMoreUrl?: string;
  checkCommand: string;
}

interface DriverState {
  config: DriverConfig;
  status: DriverStatus;
  version?: string;
  reason?: string;
  installStatus: InstallStatus;
  installOutput: string;
  installError?: string;
}

// ============================================================================
// Driver configurations
// ============================================================================

const DRIVER_CONFIGS: DriverConfig[] = [
  {
    name: "AWS Session Manager Plugin",
    description:
      "Required for SSM Bastion tunnels. Enables secure connections to databases in private VPCs via AWS Systems Manager.",
    installMethods: [
      {
        label: "Homebrew",
        command: "brew install --cask session-manager-plugin",
        platforms: ["mac"],
        executable: true,
        brewPackage: "session-manager-plugin",
      },
      {
        label: "Manual (macOS)",
        command:
          "curl https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/session-manager-plugin.pkg -o session-manager-plugin.pkg && sudo installer -pkg session-manager-plugin.pkg -target /",
        notes: "For Apple Silicon. Use mac instead of mac_arm64 for Intel.",
        platforms: ["mac"],
      },
      {
        label: "DEB (x86_64)",
        command:
          "curl https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb -o session-manager-plugin.deb && sudo dpkg -i session-manager-plugin.deb",
        platforms: ["linux"],
      },
      {
        label: "RPM (x86_64)",
        command:
          "curl https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm -o session-manager-plugin.rpm && sudo yum install -y session-manager-plugin.rpm",
        platforms: ["linux"],
      },
      {
        label: "MSI (Windows)",
        command:
          "Download from https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe and run the installer",
        platforms: ["windows"],
      },
    ],
    learnMoreUrl:
      "https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html",
    checkCommand: "check_session_manager_plugin",
  },
  {
    name: "Oracle Instant Client",
    description:
      "Required to connect to Oracle databases. Provides OCI libraries used by the Oracle adapter.",
    installMethods: [
      {
        label: "DMG (ARM64)",
        command:
          "Download the Basic Package DMG from oracle.com, open it, and copy all .dylib files to /opt/homebrew/lib/",
        notes: "For Apple Silicon Macs (M1/M2/M3/M4)",
        platforms: ["mac"],
      },
      {
        label: "Homebrew (Intel)",
        command:
          "brew tap InstantClientTap/instantclient && brew install instantclient-basic",
        notes: "Intel Macs only — does NOT work on Apple Silicon",
        platforms: ["mac"],
      },
      {
        label: "apt (x86_64)",
        command:
          "sudo apt-get install libaio1 && sudo apt-get install oracle-instantclient-basic",
        platforms: ["linux"],
      },
      {
        label: "apt (aarch64)",
        command:
          "Download the Basic Package from oracle.com for Linux ARM (aarch64), extract, and add the directory to LD_LIBRARY_PATH",
        platforms: ["linux"],
      },
      {
        label: "yum (x86_64)",
        command:
          "sudo yum install oracle-instantclient-release-el8 && sudo yum install oracle-instantclient-basic",
        platforms: ["linux"],
      },
      {
        label: "Manual download",
        command:
          "Download the Basic Package from oracle.com, extract, and add the directory to PATH",
        notes: "Download the correct architecture (x64 or ARM64) for your system",
        platforms: ["windows"],
      },
    ],
    learnMoreUrl:
      "https://www.oracle.com/database/technologies/instant-client/downloads.html",
    checkCommand: "check_oracle_client",
  },
];

// ============================================================================
// Component
// ============================================================================

export default function IntegrationsPanel() {
  const platform = detectPlatform();
  const [drivers, setDrivers] = useState<DriverState[]>(() =>
    DRIVER_CONFIGS.map((config) => ({
      config,
      status: "idle",
      installStatus: "idle",
      installOutput: "",
    })),
  );
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  // Filter install methods by platform
  const getMethodsForPlatform = useCallback(
    (methods: InstallMethod[]) =>
      methods.filter((m) => m.platforms.includes(platform)),
    [platform],
  );

  // ---- Driver status check ----

  const checkDriver = useCallback(
    async (driverName: string, command: string) => {
      setDrivers((prev) =>
        prev.map((d) =>
          d.config.name === driverName ? { ...d, status: "checking" } : d,
        ),
      );

      try {
        const result = await invoke<{
          available: boolean;
          version?: string;
          reason?: string;
        }>(command);
        setDrivers((prev) =>
          prev.map((d) =>
            d.config.name === driverName
              ? {
                  ...d,
                  status: result.available ? "installed" : "missing",
                  version: result.version,
                  reason: result.reason,
                }
              : d,
          ),
        );
      } catch {
        setDrivers((prev) =>
          prev.map((d) =>
            d.config.name === driverName ? { ...d, status: "missing" } : d,
          ),
        );
      }
    },
    [],
  );

  const checkAllDrivers = useCallback(() => {
    for (const config of DRIVER_CONFIGS) {
      void checkDriver(config.name, config.checkCommand);
    }
  }, [checkDriver]);

  useEffect(() => {
    checkAllDrivers();
  }, [checkAllDrivers]);

  // ---- Install via brew ----

  const handleInstall = useCallback(
    async (driverName: string, brewPackage: string) => {
      setDrivers((prev) =>
        prev.map((d) =>
          d.config.name === driverName
            ? { ...d, installStatus: "installing", installOutput: "", installError: undefined }
            : d,
        ),
      );

      try {
        const output = await invoke<string>("install_tool_via_brew", {
          packageName: brewPackage,
        });
        setDrivers((prev) =>
          prev.map((d) =>
            d.config.name === driverName
              ? { ...d, installStatus: "success", installOutput: output }
              : d,
          ),
        );
        // Re-check driver status after install
        const config = DRIVER_CONFIGS.find((c) => c.name === driverName);
        if (config) {
          void checkDriver(driverName, config.checkCommand);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("integrations", `Failed to install ${driverName}:`, err);
        setDrivers((prev) =>
          prev.map((d) =>
            d.config.name === driverName
              ? {
                  ...d,
                  installStatus: "error",
                  installError: message,
                  installOutput:
                    d.installOutput + (d.installOutput ? "\n" : "") + message,
                }
              : d,
          ),
        );
      }
    },
    [checkDriver],
  );

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  });

  // ---- Copy command ----

  const handleCopy = useCallback(async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (err) {
      logger.error("integrations", "Failed to copy command:", err);
    }
  }, []);

  // ---- Render ----

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10">
        <h2 className="text-base font-semibold">Integrations</h2>
        <p className="text-xs text-muted-foreground">
          External drivers and tools for database connections.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4 space-y-4">
        {drivers.map((driver) => {
          const methods = getMethodsForPlatform(driver.config.installMethods);
          const executableMethod = methods.find((m) => m.executable);
          const showInstallUI =
            driver.status === "missing" || driver.status === "error";

          return (
            <div
              key={driver.config.name}
              className="border rounded-lg p-4 space-y-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{driver.config.name}</h4>
                  {driver.status === "checking" && (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {driver.status === "installed" && (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <IconCheck className="h-3.5 w-3.5" />
                      Installed
                      {driver.version ? ` (${driver.version})` : ""}
                    </span>
                  )}
                  {driver.status === "missing" && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <IconX className="h-3.5 w-3.5" />
                      {driver.reason ? "Wrong architecture" : "Not installed"}
                    </span>
                  )}
                  {driver.status === "error" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <IconX className="h-3.5 w-3.5" />
                      Unable to detect
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() =>
                    void checkDriver(
                      driver.config.name,
                      driver.config.checkCommand,
                    )
                  }
                  disabled={driver.status === "checking"}
                >
                  <IconRefresh
                    className={cn(
                      "h-3.5 w-3.5",
                      driver.status === "checking" && "animate-spin",
                    )}
                  />
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {driver.config.description}
              </p>

              {driver.reason && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 rounded px-3 py-2">
                  {driver.reason}
                </p>
              )}

              {/* Install section */}
              {showInstallUI && (
                <div className="space-y-3 pt-1">
                  {/* Install button (for executable methods like brew) */}
                  {executableMethod && (
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={driver.installStatus === "installing"}
                        onClick={() =>
                          void handleInstall(
                            driver.config.name,
                            executableMethod.brewPackage ?? "",
                          )
                        }
                      >
                        {driver.installStatus === "installing" ? (
                          <>
                            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                            Installing...
                          </>
                        ) : driver.installStatus === "success" ? (
                          <>
                            <IconCheck className="h-3.5 w-3.5" />
                            Installed
                          </>
                        ) : (
                          <>
                            <IconDownload className="h-3.5 w-3.5" />
                            Install via {executableMethod.label}
                          </>
                        )}
                      </Button>
                      {executableMethod.notes && (
                        <span className="text-[10px] text-muted-foreground">
                          {executableMethod.notes}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Install output terminal */}
                  {(driver.installStatus === "installing" ||
                    driver.installOutput) && (
                    <div className="relative">
                      <pre
                        ref={outputRef}
                        className={cn(
                          "text-[11px] font-mono bg-zinc-950 text-zinc-300 rounded-md p-3 max-h-40 overflow-auto whitespace-pre-wrap",
                          driver.installStatus === "error" &&
                            "border border-destructive/30",
                        )}
                      >
                        {driver.installOutput || "Running installation..."}
                      </pre>
                    </div>
                  )}

                  {/* Manual methods */}
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">
                      {executableMethod
                        ? "Or install manually:"
                        : "Install using:"}
                    </p>
                    {methods
                      .filter((m) => !m.executable)
                      .map((method) => (
                        <div
                          key={method.label}
                          className="flex items-center gap-2 group"
                        >
                          <span className="text-xs text-muted-foreground w-28 shrink-0">
                            {method.label}
                          </span>
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 break-words">
                            {method.command}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => void handleCopy(method.command)}
                          >
                            {copiedCommand === method.command ? (
                              <IconCheck className="h-3 w-3 text-green-500" />
                            ) : (
                              <IconCopy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      ))}
                  </div>

                  {driver.config.learnMoreUrl && (
                    <a
                      href={driver.config.learnMoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Official downloads
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Docker tip (Oracle only) */}
              {driver.config.name === "Oracle Instant Client" && (
                <div
                  className={cn(
                    "text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2",
                    driver.status === "installed" && "mt-1",
                  )}
                >
                  <span className="font-medium">Tip:</span> Oracle database is
                  available via{" "}
                  <code className="text-[11px]">docker compose up oracle</code>{" "}
                  on port 11521. The OCI client libraries are still needed for
                  Query Pilot to connect.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
