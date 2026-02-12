/**
 * Image Preview Popover
 *
 * Clickable thumbnail that shows a larger image preview in a popover.
 * Used for message image attachments and pending images in the input area.
 * Uses Portal so it renders outside overflow-hidden containers.
 */

import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ImagePreviewPopoverProps {
  src: string;
  alt: string;
  children: ReactNode;
}

export function ImagePreviewPopover({
  src,
  alt,
  children,
}: ImagePreviewPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="overflow-hidden rounded-lg border border-border/60 hover:border-primary/50 transition-colors cursor-pointer"
          >
            {children}
          </button>
        )}
      />
      <PopoverContent
        side="top"
        sideOffset={8}
        className="w-auto max-w-[min(400px,90vw)] p-1"
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[50vh] w-auto rounded-md object-contain"
        />
      </PopoverContent>
    </Popover>
  );
}
