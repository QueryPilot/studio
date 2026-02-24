import type React from "react";
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
      {/* Terminal chrome */}
      <div className="flex items-center gap-2 border-b border-border/50 bg-muted/50 px-3 py-1.5">
        <div className="flex gap-1.5">
          <div className="size-2 rounded-full bg-red-400/40 dark:bg-red-400/25" />
          <div className="size-2 rounded-full bg-yellow-400/40 dark:bg-yellow-400/25" />
          <div className="size-2 rounded-full bg-green-400/40 dark:bg-green-400/25" />
        </div>
        <span className="flex-1 select-none text-center font-mono text-[10px] text-muted-foreground/50">
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
