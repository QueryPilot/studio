import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, X, Undo2, Redo2, GitCommit } from "lucide-react";
import { useCrudStore } from "@/stores/crudStore";
import { CommitPreviewModal } from "@/components/CommitPreviewModal";

interface StagingActionsToolbarProps {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  onCommitSuccess?: () => void;
}

export function StagingActionsToolbar(props: StagingActionsToolbarProps) {
  const { connectionId, database, schema, table, onCommitSuccess } = props;
  const {
    stagedCommands,
    getTableKey,
    discardChanges,
    undo,
    redo,
    historyIndex,
    history,
  } = useCrudStore();

  const [showCommitPreview, setShowCommitPreview] = useState(false);

  const tableKey = getTableKey({ connectionId, database, schema, table });
  const commands = stagedCommands.get(tableKey) ?? [];

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleDiscard = () => {
    discardChanges(tableKey);
  };

  const handleOpenCommitPreview = () => {
    setShowCommitPreview(true);
  };

  // Don't render if no changes
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {/* Pending Changes Badge */}
      <div className="flex items-center gap-1.5 mr-1 px-2 py-0.5 rounded-md bg-primary/10">
        <GitCommit className="h-3 w-3 text-primary" />
        <span className="text-xs font-medium text-primary">
          {commands.length} {commands.length === 1 ? "change" : "changes"}
        </span>
      </div>

      {/* Undo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={undo}
            disabled={!canUndo}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Undo (Cmd+Z)</p>
        </TooltipContent>
      </Tooltip>

      {/* Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={redo}
            disabled={!canRedo}
          >
            <Redo2 className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Redo (Cmd+Shift+Z)</p>
        </TooltipContent>
      </Tooltip>

      <div className="h-4 w-px bg-border mx-1" />

      {/* Commit */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={handleOpenCommitPreview}
          >
            <Check className="h-3 w-3 mr-1" />
            Commit
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Review and commit changes</p>
        </TooltipContent>
      </Tooltip>

      {/* Discard */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={handleDiscard}
          >
            <X className="h-3 w-3 mr-1" />
            Discard
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Discard all pending changes</p>
        </TooltipContent>
      </Tooltip>

      {/* Commit Preview Modal */}
      <CommitPreviewModal
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
