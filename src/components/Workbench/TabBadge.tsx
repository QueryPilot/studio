import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  tabId: string;
  panelId: string;
  tabType?: string;
}

const QUERY_TAB_TYPES = new Set(["query", "sql", "editor"]);

export function TabBadge({ tabId, panelId, tabType }: Props) {
  const override = useWorkbenchStore((s) => s.getTabSchemaOverride(tabId));
  if (!override || !tabType || !QUERY_TAB_TYPES.has(tabType)) return null;

  const primary = override.visibleSchemas[0] ?? "";
  const csv = override.visibleSchemas.join(", ");

  const focus = () => {
    useWorkbenchStore.getState().setActiveTab(panelId, tabId);
    usePanelFocusStore.getState().focusPanel(panelId);
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="schema-pill"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            className="mr-1 rounded bg-primary/15 px-1 text-[10px] font-medium text-primary"
            onClick={focus}
          >
            {primary}
          </button>
        }
      />
      <TooltipContent>Tab override: {csv}. Click to edit.</TooltipContent>
    </Tooltip>
  );
}
