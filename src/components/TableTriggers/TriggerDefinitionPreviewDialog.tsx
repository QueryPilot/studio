import { memo, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CodeEditor } from "@/components/CodeEditor";
import { formatSql } from "@/utils/codeFormatter";

interface TriggerDefinitionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerName: string;
  definition: string;
}

export const TriggerDefinitionPreviewDialog = memo(
  function TriggerDefinitionPreviewDialog({
    open,
    onOpenChange,
    triggerName,
    definition,
  }: TriggerDefinitionPreviewDialogProps) {
    // Auto-format SQL on display
    const formattedDefinition = useMemo(() => {
      if (!definition) return "";
      return formatSql(definition, "postgresql");
    }, [definition]);

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Trigger Definition</DialogTitle>
            <DialogDescription>
              Definition for trigger <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{triggerName}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-[200px] max-h-[50vh] border rounded-md overflow-hidden">
            <CodeEditor
              value={formattedDefinition}
              readOnly
              language="sql"
              dialect="postgresql"
              lineNumbers
              height="100%"
              minHeight="200px"
              maxHeight="50vh"
            />
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);

export default TriggerDefinitionPreviewDialog;
