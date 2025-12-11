import type { Icon } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface ActionCardProps {
  icon: Icon;
  title: string;
  description: string;
  onClick: () => void;
  compact?: boolean;
}

export function ActionCard({
  icon: Icon,
  title,
  description,
  onClick,
  compact = false,
}: ActionCardProps) {
  if (compact) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          "hover:border-amber-500/50 transition-colors cursor-pointer",
          "flex items-center gap-3",
        )}
        onClick={onClick}
      >
        <div className="p-2 rounded-md bg-amber-500/10 flex-shrink-0">
          <Icon className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-medium text-foreground truncate">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground truncate">
            {description}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        "hover:border-amber-500/50 transition-colors cursor-pointer",
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-lg bg-amber-500/10 flex-shrink-0">
          <Icon className="h-4 w-4 text-amber-500" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </div>
  );
}
