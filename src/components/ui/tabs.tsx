import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { useEffect, useRef, useCallback } from "react";

import { cn } from "@/lib/utils";

// Extended props for backwards compatibility with custom shortcut features
type TabsProps = TabsPrimitive.Root.Props & {
  enableShortcuts?: boolean;
  tabGroupId?: string;
  focused?: boolean;
  enableGlobalShortcuts?: boolean;
};

function Tabs({
  className,
  orientation = "horizontal",
  enableShortcuts = false,
  tabGroupId: _tabGroupId,
  focused = false,
  enableGlobalShortcuts: _enableGlobalShortcuts,
  onValueChange,
  children,
  ...props
}: TabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle Cmd+1/2/3/etc keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle if shortcuts are enabled and panel is focused
      if (!enableShortcuts || !focused) return;

      // Check for Cmd/Ctrl + number (1-9)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          const container = containerRef.current;
          if (!container) return;

          // Find all tab triggers in order
          const triggers = container.querySelectorAll<HTMLButtonElement>(
            '[data-slot="tabs-trigger"]'
          );
          const index = num - 1; // Convert 1-based to 0-based index

          if (index < triggers.length) {
            const trigger = triggers[index];
            // Get the value from the trigger's data attribute
            const value = trigger.getAttribute("data-value");
            if (value && onValueChange) {
              e.preventDefault();
              e.stopPropagation();
              onValueChange(value);
            }
          }
        }
      }
    },
    [enableShortcuts, focused, onValueChange]
  );

  useEffect(() => {
    if (!enableShortcuts) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableShortcuts, handleKeyDown]);

  return (
    <TabsPrimitive.Root
      ref={containerRef}
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "gap-2 group/tabs flex data-[orientation=horizontal]:flex-col",
        className,
      )}
      onValueChange={onValueChange}
      {...props}
    >
      {children}
    </TabsPrimitive.Root>
  );
}

const tabsListVariants = cva(
  "rounded-lg data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
      size: {
        default: "p-[3px] group-data-horizontal/tabs:h-8",
        sm: "p-0.5 group-data-horizontal/tabs:h-6",
        xs: "p-0.5 group-data-horizontal/tabs:h-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  size = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}
    />
  );
}

const tabsTriggerVariants = cva(
  [
    "gap-1.5 rounded-md border border-transparent text-xs font-medium group-data-vertical/tabs:py-[calc(--spacing(1.25))] [&_svg:not([class*='size-'])]:size-3.5 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
    "data-active:bg-background dark:data-active:text-foreground dark:data-active:border-transparent dark:data-active:bg-background data-active:text-foreground",
    "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity after:duration-150 group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
  ],
  {
    variants: {
      size: {
        default: "px-1.5 py-0.5",
        sm: "px-2 py-0.5",
        xs: "px-1.5 py-0",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function TabsTrigger({
  className,
  size,
  value,
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTriggerVariants>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      data-value={value}
      value={value}
      className={cn(tabsTriggerVariants({ size }), className)}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("text-xs/relaxed flex-1 outline-none", className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListVariants,
  tabsTriggerVariants,
};
