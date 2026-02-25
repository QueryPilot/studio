import type React from "react";
import { IconTerminal2 } from "@tabler/icons-react";
import { CodeEditor } from "@/components/CodeEditor";
import { buildPreviewText } from "./buildCommand";
import type { CollectionDesignerState } from "./types";

interface CommandPreviewProps {
  state: CollectionDesignerState;
}

export const CommandPreview: React.FC<CommandPreviewProps> = ({ state }) => {
  const previewText = buildPreviewText(state);

  return (
    <div className="h-fit rounded-lg border border-border/60 shadow-sm lg:sticky lg:top-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-border/50 bg-muted/50 px-3 py-1.5">
        <IconTerminal2 className="size-3.5 text-muted-foreground/50" />
        <span className="select-none font-mono text-[10px] text-muted-foreground/50">
          command preview
        </span>
      </div>

      {/* Editor body */}
      <CodeEditor
        value={previewText}
        language="javascript"
        readOnly
        lineNumbers={false}
        minHeight="100px"
        maxHeight="600px"
      />
    </div>
  );
};
