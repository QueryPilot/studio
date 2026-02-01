import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  IconArrowLeft,
  IconDatabaseExport,
  IconDatabaseImport,
} from "@tabler/icons-react";

interface OperationStepProps {
  onSelect: (op: "backup" | "restore") => void;
  onBack: () => void;
}

export const OperationStep = ({ onSelect, onBack }: OperationStepProps) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Go back to connection selection"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">Choose Operation</h2>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <Card
          role="button"
          tabIndex={0}
          aria-label="Select backup operation to export database"
          className={cn(
            "p-6 cursor-pointer transition-all duration-150 outline-none",
            "hover:bg-accent/50",
            "focus:ring-2 focus:ring-primary focus:ring-offset-2",
            "group"
          )}
          onClick={() => { onSelect("backup"); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("backup");
            }
          }}
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <IconDatabaseExport className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Backup</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Export database to a file
              </p>
            </div>
          </div>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          aria-label="Select restore operation to import database"
          className={cn(
            "p-6 cursor-pointer transition-all duration-150 outline-none",
            "hover:bg-accent/50",
            "focus:ring-2 focus:ring-primary focus:ring-offset-2",
            "group"
          )}
          onClick={() => { onSelect("restore"); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("restore");
            }
          }}
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <IconDatabaseImport className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Restore</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Import database from a file
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
