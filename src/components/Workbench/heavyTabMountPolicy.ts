import type { TabMetadata } from "@/types/workbench";

export const HIDDEN_TAB_BUDGET = 6;

interface GetMountedTabsOptions {
  activeTabId: string | null;
  tabIds: string[];
  metadataByTab?: Record<string, TabMetadata | undefined>;
  recentOrder: string[];
  hiddenTabBudget?: number;
}

function getHiddenTabWeight(metadata?: TabMetadata): number | null {
  switch (metadata?.type) {
    case "query":
    case "mongo-query":
      return 4;
    case "redis-cli":
    case "redis-key":
      return 2;
    case "table":
      return metadata.viewType === "data" ? 2 : null;
    case "mongo-collection":
      return metadata.viewType === "data" ? 2 : null;
    default:
      return null;
  }
}

export function recordVisit(recentOrder: string[], tabId: string): string[] {
  if (recentOrder[0] === tabId) {
    return recentOrder;
  }
  const filtered = recentOrder.filter((id) => id !== tabId);
  return [tabId, ...filtered];
}

export function getMountedTabs({
  activeTabId,
  tabIds,
  metadataByTab,
  recentOrder,
  hiddenTabBudget = HIDDEN_TAB_BUDGET,
}: GetMountedTabsOptions): Set<string> {
  const validTabIds = new Set(tabIds);
  const mounted = new Set<string>();
  let remainingBudget = hiddenTabBudget;

  if (activeTabId && validTabIds.has(activeTabId)) {
    mounted.add(activeTabId);
  }

  for (const tabId of recentOrder) {
    if (!validTabIds.has(tabId) || tabId === activeTabId) {
      continue;
    }

    const weight = getHiddenTabWeight(metadataByTab?.[tabId]);
    if (weight == null || weight > remainingBudget) {
      continue;
    }

    mounted.add(tabId);
    remainingBudget -= weight;
  }

  return mounted;
}
