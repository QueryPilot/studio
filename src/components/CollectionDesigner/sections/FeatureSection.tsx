import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-toggle`}>{label}</Label>
              {badge && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {badge}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
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
      {enabled && <div className="mt-3">{children}</div>}
    </div>
  );
};
