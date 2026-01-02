import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconDeviceFloppy, IconX } from "@tabler/icons-react";
import { useCrudStore } from "@/stores/crudStore";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";

interface StagingActionsToolbarProps {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  onCommitSuccess?: () => void;
  onBeforeCommitPreview?: () => void | Promise<void>;
}

export function StagingActionsToolbar(props: StagingActionsToolbarProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    onCommitSuccess,
    onBeforeCommitPreview,
  } = props;
  const { stagedCommands, getTableKey, discardChanges } = useCrudStore();

  const [showCommitPreview, setShowCommitPreview] = useState(false);

  const tableKey = getTableKey({ connectionId, database, schema, table });
  const commands = stagedCommands.get(tableKey) ?? [];

  const handleDiscard = () => {
    discardChanges(tableKey);
  };

  const handleOpenCommitPreview = async () => {
    // Ensure any active cell editor commits before showing the preview
    if (onBeforeCommitPreview) {
      await onBeforeCommitPreview();
    }
    setShowCommitPreview(true);
  };

  // Don't render if no changes
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {/* Commit with count */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenCommitPreview}
            >
              <IconDeviceFloppy className="size-3.5!" />
              Commit
            </Button>
          }
        />
        <TooltipContent>
          <p className="text-xs">
            Review and commit {commands.length}{" "}
            {commands.length === 1 ? "change" : "changes"}
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Discard */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" size="sm" onClick={handleDiscard}>
              <IconX className="size-3.5!" />
              Discard
            </Button>
          }
        />
        <TooltipContent>
          <p className="text-xs">Discard all pending changes</p>
        </TooltipContent>
      </Tooltip>

      {/* Commit Preview Dialog */}
      <GlobalChangesDialog
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        open={showCommitPreview}
        onOpenChange={setShowCommitPreview}
        onCommitSuccess={onCommitSuccess}
      />
    </div>
  );
}
