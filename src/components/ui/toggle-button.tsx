import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

interface ToggleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  children: React.ReactNode;
}

export const ToggleButton = React.forwardRef<
  HTMLButtonElement,
  ToggleButtonProps
>(({ className, isActive, ...props }, ref) => (
  <Button
    ref={ref}
    variant={isActive ? "default" : "ghost"}
    size="sm"
    className={cn(
      "h-5 px-1.5 text-xs rounded-sm transition-colors duration-200 ease-in-out",
      className,
    )}
    {...props}
  />
));
ToggleButton.displayName = "ToggleButton";
