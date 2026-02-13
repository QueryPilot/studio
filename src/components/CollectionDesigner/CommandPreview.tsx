import type React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeEditor } from "@/components/CodeEditor";
import { buildPreviewText } from "./buildCommand";
import type { CollectionDesignerState } from "./types";

interface CommandPreviewProps {
  state: CollectionDesignerState;
}

export const CommandPreview: React.FC<CommandPreviewProps> = ({ state }) => {
  const previewText = buildPreviewText(state);

  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader className="border-b">
        <CardTitle>Command Preview</CardTitle>
        <CardDescription>
          Live preview of the MongoDB command.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="rounded-md border overflow-hidden">
          <CodeEditor
            value={previewText}
            language="text"
            readOnly
            lineNumbers={false}
            minHeight="100px"
            maxHeight="600px"
          />
        </div>
      </CardContent>
    </Card>
  );
};
