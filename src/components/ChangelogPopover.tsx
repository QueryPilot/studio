import { useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconFileText } from "@tabler/icons-react";
import { Streamdown } from "streamdown";
import changelogRaw from "../../CHANGELOG.md?raw";

export function ChangelogPopover() {
  const changelog = useMemo(() => {
    return changelogRaw
      .replace(/^#\s+Changelog\s*/m, "")
      .replace(/<!--[\s\S]*?-->\s*/g, "")
      .trimStart();
  }, []);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <IconFileText className="h-4 w-4 mr-2" />
            View Changelog
          </Button>
        }
      />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-[500px]! max-h-[60vh] flex flex-col p-0! gap-0!"
      >
        <div className="shrink-0 px-4 py-3 border-b">
          <p className="text-xs font-medium">Changelog</p>
          <p className="text-[11px] text-muted-foreground">
            All notable changes to Query Pilot
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
            <Streamdown className="select-text">{changelog}</Streamdown>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
