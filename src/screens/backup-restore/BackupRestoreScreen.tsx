import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { isTauri } from "@/utils/tauri";
import { WindowControls } from "@/components/WindowControls";
import { vaultStorage } from "@/services/vaultStorage";
import { type ConnectionProfile } from "@/types/connection";
import {
  ConnectionStep,
  OperationStep,
  ToolCheckStep,
  BackupConfigStep,
  RestoreConfigStep,
  ExecuteStep,
  type BackupConfig,
  type RestoreConfig,
} from "./steps";

type WizardStep = "connection" | "operation" | "tools" | "config" | "execute";

const STEP_LABELS: Record<WizardStep, string> = {
  connection: "Select Connection",
  operation: "Choose Operation",
  tools: "Check Tools",
  config: "Configure",
  execute: "Execute",
};

const STEPS: WizardStep[] = ["connection", "operation", "tools", "config", "execute"];

export function BackupRestoreScreen() {
  const [searchParams] = useSearchParams();
  const preselectedConnectionId = searchParams.get("connectionId");

  const [currentStep, setCurrentStep] = useState<WizardStep>("connection");
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(preselectedConnectionId);
  const [connectionProfile, setConnectionProfile] = useState<ConnectionProfile | null>(null);
  const [operation, setOperation] = useState<"backup" | "restore" | null>(null);
  const [backupConfig, setBackupConfig] = useState<BackupConfig | null>(null);
  const [restoreConfig, setRestoreConfig] = useState<RestoreConfig | null>(
    null
  );
  // Partial config to preserve state when navigating back
  const [partialBackupConfig, setPartialBackupConfig] = useState<{
    destinationPath?: string;
    format?: string;
    options?: Record<string, unknown>;
  }>({});
  const [partialRestoreConfig, setPartialRestoreConfig] = useState<{
    sourcePath?: string;
    options?: Record<string, unknown>;
  }>({});

  // Register window with Tauri on mount
  useEffect(() => {
    if (isTauri()) {
      // Register as backup-restore window type
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const currentWindow = getCurrentWindow();
          // Set window title based on operation
          await currentWindow.setTitle("Backup & Restore");
        } catch {
          // Ignore errors in non-Tauri environment
        }
      })();
    }
  }, []);

  // Load profile when connection ID is selected/preselected
  useEffect(() => {
    if (!selectedConnectionId) {
      setConnectionProfile(null);
      return;
    }

    let mounted = true;
    async function loadProfile() {
      try {
        const connections = await vaultStorage.listConnections();
        const conn = connections.find((c) => c.profile.id === selectedConnectionId);
        if (mounted && conn) {
          setConnectionProfile(conn.profile);
        }
      } catch {
        // Profile not found - will show error in config step
      }
    }
    void loadProfile();

    return () => {
      mounted = false;
    };
  }, [selectedConnectionId]);

  // Skip connection step if pre-selected
  useEffect(() => {
    if (preselectedConnectionId && currentStep === "connection") {
      setCurrentStep("operation");
    }
  }, [preselectedConnectionId, currentStep]);

  const currentStepIndex = STEPS.indexOf(currentStep);

  // Navigation handlers
  const handleConnectionSelect = (id: string) => {
    setSelectedConnectionId(id);
    setCurrentStep("operation");
  };

  const handleOperationSelect = (op: "backup" | "restore") => {
    setOperation(op);
    setCurrentStep("tools");
  };

  const handleToolsReady = () => {
    setCurrentStep("config");
  };

  const handleBackupStart = (config: BackupConfig) => {
    setBackupConfig(config);
    setCurrentStep("execute");
  };

  const handleRestoreStart = (config: RestoreConfig) => {
    setRestoreConfig(config);
    setCurrentStep("execute");
  };

  const handleComplete = async () => {
    // Close the window if in Tauri environment
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        await currentWindow.close();
      } catch {
        // Fallback: reset wizard to initial state
        resetWizard();
      }
    } else {
      // In browser, reset the wizard
      resetWizard();
    }
  };

  const resetWizard = () => {
    setCurrentStep(preselectedConnectionId ? "operation" : "connection");
    setOperation(null);
    setBackupConfig(null);
    setRestoreConfig(null);
    setPartialBackupConfig({});
    setPartialRestoreConfig({});
    if (!preselectedConnectionId) {
      setSelectedConnectionId(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Titlebar — drag region + window controls */}
      <div
        data-tauri-drag-region
        className="h-8 w-full shrink-0 flex items-center"
      >
        <div className="flex items-center gap-2 pl-3 pointer-events-none" data-tauri-drag-region>
          <img src="/logo.png" alt="" className="size-4 rounded-sm" draggable={false} />
          <span className="text-xs font-medium text-foreground/70 select-none">Backup & Restore</span>
        </div>
        <div className="flex-1" data-tauri-drag-region />
        <WindowControls />
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar - Steps */}
      <div className="w-56 border-r bg-muted/30 flex flex-col">
        {/* Title */}
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Backup & Restore</h1>
        </div>

        {/* Step List */}
        <nav className="flex-1 p-3 space-y-1">
          {STEPS.map((step, index) => {
            const isActive = step === currentStep;
            const isCompleted = index < currentStepIndex;
            const isDisabled = index > currentStepIndex;

            return (
              <div
                key={step}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "text-primary hover:bg-primary/10 cursor-pointer"
                      : isDisabled
                        ? "text-muted-foreground"
                        : ""
                }`}
                onClick={() => {
                  // Allow clicking on completed steps to go back
                  if (isCompleted) {
                    setCurrentStep(step);
                  }
                }}
              >
                {/* Step number/indicator */}
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                    isActive
                      ? "bg-primary-foreground/20"
                      : isCompleted
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? "✓" : index + 1}
                </div>
                <span className="font-medium">{STEP_LABELS[step]}</span>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl">
          {currentStep === "connection" && (
            <ConnectionStep
              selectedId={selectedConnectionId}
              onSelect={handleConnectionSelect}
            />
          )}

          {currentStep === "operation" && (
            <OperationStep
              onSelect={handleOperationSelect}
              onBack={() => setCurrentStep("connection")}
            />
          )}

          {currentStep === "tools" && connectionProfile && (
            <ToolCheckStep
              profile={connectionProfile}
              onToolsReady={handleToolsReady}
              onBack={() => setCurrentStep("operation")}
            />
          )}

          {currentStep === "config" && connectionProfile && (
            <>
              {operation === "backup" && (
                <BackupConfigStep
                  profile={connectionProfile}
                  initialConfig={partialBackupConfig}
                  onConfigChange={setPartialBackupConfig}
                  onStart={handleBackupStart}
                  onBack={() => setCurrentStep("operation")}
                />
              )}
              {operation === "restore" && (
                <RestoreConfigStep
                  profile={connectionProfile}
                  initialConfig={partialRestoreConfig}
                  onConfigChange={setPartialRestoreConfig}
                  onStart={handleRestoreStart}
                  onBack={() => setCurrentStep("operation")}
                />
              )}
            </>
          )}

          {currentStep === "execute" &&
            connectionProfile &&
            operation &&
            (operation === "backup" ? backupConfig : restoreConfig) && (
              <ExecuteStep
                profile={connectionProfile}
                operation={operation}
                config={
                  operation === "backup"
                    ? (backupConfig as BackupConfig)
                    : (restoreConfig as RestoreConfig)
                }
                onComplete={() => void handleComplete()}
                onBack={() => setCurrentStep("config")}
              />
            )}
        </div>
      </div>
      </div>
    </div>
  );
}
