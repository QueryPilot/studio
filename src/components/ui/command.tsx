"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { IconSearch, IconCheck, IconArrowLeft } from "@tabler/icons-react";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "bg-popover text-popover-foreground rounded-xl p-1 flex size-full flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  onKeyDown,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "rounded-xl! p-0 overflow-hidden w-[680px] max-w-[680px]",
          className,
        )}
        showCloseButton={showCloseButton}
      >
        <Command
          className="**:[[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:border-b **:data-[slot=command-input-wrapper]:pb-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:font-medium [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 **:[[cmdk-input]]:h-12 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
          onKeyDown={onKeyDown}
          onValueChange={onValueChange}
          shouldFilter={false}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  onBack,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  onBack?: () => void;
}) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <div
        data-slot="input-group"
        className="h-8 relative flex w-full min-w-0 items-center outline-none -mt-0.5"
      >
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground pl-2 flex cursor-pointer items-center justify-center select-none order-first hover:text-foreground transition-colors"
          >
            <IconArrowLeft className="size-4! shrink-0" />
          </button>
        ) : (
          <div className="text-muted-foreground pl-2 flex cursor-text items-center justify-center select-none order-first">
            <IconSearch className="size-4! shrink-0" />
          </div>
        )}
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full h-full bg-transparent pl-2 pr-2 text-sm/relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-[360px] scroll-py-1 outline-none overflow-x-hidden overflow-y-auto",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-xs/relaxed", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border/50 -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-selected:bg-muted data-selected:text-foreground data-selected:*:[svg]:text-foreground relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden select-none [&_svg:not([class*='size-'])]:size-3.5 in-data-[slot=dialog-content]:rounded-md group/command-item data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <IconCheck className="ml-auto hidden group-data-[checked=true]/command-item:block" />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-[0.625rem] tracking-widest",
        className,
      )}
      {...props}
    />
  );
}

interface CommandFooterProps extends React.ComponentProps<"div"> {
  actionsButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onActionsClick?: () => void;
  showActions?: boolean;
}

function CommandFooter({
  className,
  actionsButtonRef,
  onActionsClick,
  showActions = false,
  ...props
}: CommandFooterProps) {
  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      data-slot="command-footer"
      className={cn(
        "border-t border-border/50 bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-4 -mb-1",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-1">
        <KbdGroup>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </KbdGroup>
        <span className="ml-1">Navigate</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>⏎</Kbd>
        <span className="ml-1">Open</span>
      </span>
      <span className="flex items-center gap-1">
        <KbdGroup>
          <Kbd>{modKey}</Kbd>
          <Kbd>⏎</Kbd>
        </KbdGroup>
        <span className="ml-1">Open in Split</span>
      </span>
      {showActions && (
        <button
          ref={actionsButtonRef}
          type="button"
          onClick={onActionsClick}
          className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors cursor-default"
        >
          <span>Actions</span>
          <KbdGroup>
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </button>
      )}
    </div>
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
};
