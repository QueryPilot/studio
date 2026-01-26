import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { isTauri } from "@/utils/tauri";

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedConnectionId, _setSelectedConnectionId] = useState<
    string | null
  >(preselectedConnectionId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [operation, _setOperation] = useState<"backup" | "restore" | null>(
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

  // Skip connection step if pre-selected
  useEffect(() => {
    if (preselectedConnectionId && currentStep === "connection") {
      setCurrentStep("operation");
    }
  }, [preselectedConnectionId, currentStep]);

  const currentStepIndex = STEPS.indexOf(currentStep);

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
        {currentStep === "connection" && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">Select Connection</h2>
            <p className="text-muted-foreground mb-6">
              Choose a database connection to backup or restore.
            </p>
            {/* ConnectionStep placeholder */}
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Connection selection step (to be implemented)
            </div>
          </div>
        )}

        {currentStep === "operation" && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">Choose Operation</h2>
            <p className="text-muted-foreground mb-6">
              Select whether you want to backup or restore the database.
            </p>
            {/* OperationStep placeholder */}
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Operation selection step (to be implemented)
              {selectedConnectionId && (
                <p className="mt-2 text-sm">
                  Selected connection: {selectedConnectionId}
                </p>
              )}
            </div>
          </div>
        )}

        {currentStep === "config" && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">
              Configure {operation === "backup" ? "Backup" : "Restore"}
            </h2>
            <p className="text-muted-foreground mb-6">
              Set the options for your {operation} operation.
            </p>
            {/* ConfigStep placeholder */}
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Configuration step (to be implemented)
              {operation && (
                <p className="mt-2 text-sm">Operation: {operation}</p>
              )}
            </div>
          </div>
        )}

        {currentStep === "execute" && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">
              {operation === "backup" ? "Backup" : "Restore"} Progress
            </h2>
            <p className="text-muted-foreground mb-6">
              {operation === "backup"
                ? "Creating backup of your database..."
                : "Restoring your database from backup..."}
            </p>
            {/* ExecuteStep placeholder */}
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              Execution step (to be implemented)
            </div>
          </div>
        )}
      </div>

      {/* Footer with navigation buttons - placeholder */}
      <div className="flex items-center justify-between p-4 border-t">
        <button
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          disabled={currentStep === "connection" && !preselectedConnectionId}
          onClick={() => {
            const prevIndex = currentStepIndex - 1;
            const prevStep = STEPS[prevIndex];
            if (prevIndex >= 0 && prevStep) {
              setCurrentStep(prevStep);
            }
          }}
        >
          Back
        </button>
        <button
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          disabled={currentStep === "execute"}
          onClick={() => {
            const nextIndex = currentStepIndex + 1;
            const nextStep = STEPS[nextIndex];
            if (nextIndex < STEPS.length && nextStep) {
              setCurrentStep(nextStep);
            }
          }}
        >
          {currentStep === "config" ? "Start" : "Next"}
        </button>
      </div>
    </div>
  );
}
