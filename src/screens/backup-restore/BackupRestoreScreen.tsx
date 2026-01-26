import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { isTauri } from "@/utils/tauri";
import { vaultStorage } from "@/services/vaultStorage";
import { type ConnectionProfile } from "@/types/connection";
import {
  ConnectionStep,
  OperationStep,
  BackupConfigStep,
  RestoreConfigStep,
  ExecuteStep,
  type BackupConfig,
  type RestoreConfig,
} from "./steps";

type WizardStep = "connection" | "operation" | "config" | "execute";

const STEP_LABELS: Record<WizardStep, string> = {
  connection: "Select Connection",
  operation: "Choose Operation",
  config: "Configure",
  execute: "Execute",
};

const STEPS: WizardStep[] = ["connection", "operation", "config", "execute"];

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
    if (!preselectedConnectionId) {
      setSelectedConnectionId(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header with title and step indicator */}
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-lg font-semibold">Backup & Restore</h1>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => {
            const isActive = step === currentStep;
            const isCompleted = index < currentStepIndex;
            const isDisabled = index > currentStepIndex;

            return (
              <div key={step} className="flex items-center">
                {index > 0 && (
                  <div
                    className={`w-8 h-px mx-2 ${
                      isCompleted ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "bg-primary/20 text-primary"
                        : isDisabled
                          ? "bg-muted text-muted-foreground"
                          : ""
                  }`}
                >
                  <span className="font-medium">{index + 1}</span>
                  <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content area - render step based on currentStep */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto">
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

          {currentStep === "config" && connectionProfile && (
            <>
              {operation === "backup" && (
                <BackupConfigStep
                  profile={connectionProfile}
                  onStart={handleBackupStart}
                  onBack={() => setCurrentStep("operation")}
                />
              )}
              {operation === "restore" && (
                <RestoreConfigStep
                  profile={connectionProfile}
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
  );
}
