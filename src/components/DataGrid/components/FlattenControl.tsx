import { memo } from "react";
import { IconBrackets } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FlattenControlProps {
  enabled: boolean;
  depth: number;
  onToggle: () => void;
  onDepthChange: (depth: number) => void;
}

export const FlattenControl = memo(function FlattenControl({
  enabled,
  depth,
  onToggle,
  onDepthChange,
}: FlattenControlProps) {
  return (
    <Popover>
      <div className="flex items-center">
        <Button
          size="sm"
          variant={enabled ? "default" : "outline"}
          className="h-7 text-[11px] rounded-r-none"
          onClick={onToggle}
        >
          <IconBrackets className="h-3.5 w-3.5 mr-1" />
          {enabled ? `Flat: ${depth}` : "Nested"}
        </Button>
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant={enabled ? "default" : "outline"}
              className="h-7 w-6 px-0 rounded-l-none border-l-0"
            />
          }
        >
          <span className="text-[10px]">&#9662;</span>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-40 p-2" align="end">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Depth</span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 text-[11px]"
              disabled={depth <= 1}
              onClick={() => onDepthChange(Math.max(1, depth - 1))}
            >
              -
            </Button>
            <span className="w-5 text-center text-[11px] font-mono">
              {depth}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 text-[11px]"
              disabled={depth >= 6}
              onClick={() => onDepthChange(Math.min(6, depth + 1))}
            >
              +
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
