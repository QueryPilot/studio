import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type SidebarStatus =
  | "ok"
  | "readonly"
  | "disconnected"
  | "primary"
  | "loading"
  | "error";

interface SidebarStatusDotProps {
  status: SidebarStatus;
  label?: string;
  className?: string;
}

const STATUS_STYLES: Record<SidebarStatus, string> = {
  ok: "bg-emerald-500/70",
  readonly: "bg-transparent border border-muted-foreground/60",
  disconnected: "bg-transparent border border-destructive/70",
  primary: "bg-amber-500/80",
  loading: "bg-muted-foreground/40 animate-pulse",
  error: "bg-destructive/80",
};

const STATUS_LABELS: Record<SidebarStatus, string> = {
  ok: "Connected",
  readonly: "Read-only",
  disconnected: "Disconnected",
  primary: "Primary",
  loading: "Loading",
  error: "Error",
};

export function SidebarStatusDot({
  status,
  label,
  className,
}: SidebarStatusDotProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              STATUS_STYLES[status],
              className,
            )}
            aria-label={label ?? STATUS_LABELS[status]}
            role="img"
          />
        }
      />
      <TooltipContent side="right" sideOffset={6}>
        <span className="text-xs">{label ?? STATUS_LABELS[status]}</span>
      </TooltipContent>
    </Tooltip>
  );
}
