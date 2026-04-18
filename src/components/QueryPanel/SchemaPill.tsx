import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { toast } from "sonner";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { SchemaMultiSelectContent } from "@/components/schemas/SchemaMultiSelectContent";

interface Props {
  tabId: string;
  connectionId: string;
  database: string;
}

export function SchemaPill({ tabId, connectionId, database }: Props) {
  const [open, setOpen] = useState(false);
  const override = useWorkbenchStore((s) => s.getTabSchemaOverride(tabId));
  const connectionSchemas = useConnectionStore
    .getState()
    .getVisibleSchemas(connectionId, database);
  const primary = override?.visibleSchemas[0] ?? connectionSchemas[0] ?? "(none)";
  const isOverride = !!override;

  const clearOverride = () => {
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, null);
    toast.success("Tab override removed");
  };

  const applyToTab = (schemas: string[]) => {
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, schemas);
  };

  const applyToConnection = async () => {
    const draft = override?.visibleSchemas ?? connectionSchemas;
    await useConnectionStore
      .getState()
      .setVisibleSchemas(connectionId, database, draft);
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-testid="schema-pill"
        className={
          isOverride
            ? "inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-primary-foreground"
            : "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-muted-foreground"
        }
      >
        <PopoverTrigger
          nativeButton={false}
          render={
            <span
              role="button"
              tabIndex={0}
              className="text-xs cursor-pointer"
            >
              Schema: {primary}{" "}
              <span className="opacity-70">
                {isOverride ? "(tab override)" : "(from connection)"}
              </span>
            </span>
          }
        />
        {isOverride && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Clear tab override"
            className="h-4 w-4 p-0"
            onClick={(e) => {
              e.stopPropagation();
              clearOverride();
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <PopoverContent align="start" className="w-80 p-0">
        <SchemaMultiSelectContent
          connectionId={connectionId}
          database={database}
          initialSchemas={override?.visibleSchemas ?? connectionSchemas}
          scopeLabel={isOverride ? "This tab" : "Connection"}
          onApply={
            isOverride
              ? applyToTab
              : async (s) => {
                  await useConnectionStore
                    .getState()
                    .setVisibleSchemas(connectionId, database, s);
                }
          }
          footerSlot={
            isOverride ? (
              <button
                className="text-xs underline text-muted-foreground"
                onClick={() => void applyToConnection()}
              >
                Apply to connection instead
              </button>
            ) : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}
