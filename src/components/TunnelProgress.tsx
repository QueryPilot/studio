import { useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface TunnelProgressProps {
  connectionId: string;
  hasTunnel: boolean;
  tunnelType?: "ssh" | "ssm";
  onCancel: () => void;
}

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

interface TunnelProgressEvent {
  step: number;
  status: StepStatus;
  detail?: string;
}

function buildInitialSteps(
  hasTunnel: boolean,
  tunnelType?: "ssh" | "ssm",
): Step[] {
  if (!hasTunnel) {
    return [{ label: "Connecting to database", status: "active" }];
  }

  if (tunnelType === "ssm") {
    return [
      { label: "Authenticating", status: "active" },
      { label: "Launching bastion", status: "pending" },
      { label: "Establishing tunnel", status: "pending" },
      { label: "Connecting to database", status: "pending" },
    ];
  }

  // SSH tunnel
  return [
    { label: "Connecting tunnel", status: "active" },
    { label: "Connecting to database", status: "pending" },
  ];
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <IconCheck className="h-3.5 w-3.5 text-green-500" />;
    case "active":
      return <IconLoader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case "error":
      return <IconCircle className="h-3.5 w-3.5 fill-current text-red-500" />;
    case "pending":
    default:
      return <IconCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function TunnelProgress({
  connectionId,
  hasTunnel,
  tunnelType,
  onCancel,
}: TunnelProgressProps) {
  const [steps, setSteps] = useState<Step[]>(() =>
    buildInitialSteps(hasTunnel, tunnelType),
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<TunnelProgressEvent>(
        `tunnel-progress-${connectionId}`,
        (event) => {
          const { step, status, detail } = event.payload;
          setSteps((prev) =>
            prev.map((s, i) => (i === step ? { ...s, status, detail } : s)),
          );
        },
      );
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [connectionId]);

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span
              className={cn(
                "text-sm",
                step.status === "active" && "text-foreground font-medium",
                step.status === "done" && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground",
                step.status === "error" && "text-red-500",
              )}
            >
              {step.label}
            </span>
            {step.detail && (
              <span className="text-xs text-muted-foreground">
                {step.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
