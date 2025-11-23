import { IconPlus, IconSchema } from "@tabler/icons-react";
import { useHomeScreenStore } from "../../store/homeScreenStore";

export function ActionBarActions() {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);

  const handleNewConnection = () => {
    openConnectionForm("create");
  };

  const handleNewERD = () => {
    // TODO: Implement ERD workspace creation
    console.log("Create ERD workspace");
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <div
        className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-amber-500/50 cursor-pointer transition-colors"
        onClick={handleNewConnection}
      >
        <div className="flex items-center justify-center h-6 w-6 rounded-md bg-secondary">
          <IconPlus className="h-5 w-5 text-amber-500" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium">New Connection</span>
          <span className="text-[10px] text-muted-foreground">
            Add a new database connection
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-amber-500/50 cursor-pointer transition-colors"
        onClick={handleNewERD}
      >
        <div className="flex items-center justify-center h-6 w-6 rounded-md bg-secondary">
          <IconSchema className="h-5 w-5 text-amber-500" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium">ERD Workspace</span>
          <span className="text-[10px] text-muted-foreground">
            Create entity relationship diagram
          </span>
        </div>
      </div>
    </div>
  );
}
