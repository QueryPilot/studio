import type React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FeatureSectionProps {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  badge?: string;
  children: React.ReactNode;
}

export const FeatureSection: React.FC<FeatureSectionProps> = ({
  id,
  label,
  description,
  enabled,
  onToggle,
  disabled,
  disabledReason,
  badge,
  children,
}) => {
  const switchElement = (
    <Switch
      id={`${id}-toggle`}
      checked={enabled}
      onCheckedChange={onToggle}
      disabled={disabled}
    />
  );

  return (
    <div
      className={cn(
        "rounded-lg border-l-2 transition-all duration-200",
        enabled
          ? "border-l-primary bg-card shadow-sm"
          : "border-l-muted-foreground/15 bg-card/40",
        disabled && "opacity-50",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`${id}-toggle`}
              className={cn(
                "text-[13px] transition-colors duration-150",
                enabled ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </Label>
            {badge && (
              <span className="rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/70">{description}</p>
        </div>
        {disabled && disabledReason ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="cursor-not-allowed">
                {switchElement}
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">{disabledReason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          switchElement
        )}
      </div>

      {/* Animated expand/collapse content */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          enabled
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border/50 px-3 pb-3 pt-2.5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
