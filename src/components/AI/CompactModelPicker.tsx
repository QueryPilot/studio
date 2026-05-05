/**
 * Compact Model Picker (BYOK only)
 *
 * Inline model dropdown for BYOK mode in the AI panel footer.
 * For ACP mode, use ModelSelector instead.
 */

import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import { BYOK_ENABLED } from "@/ai/featureFlags";

export function CompactModelPicker() {
  // BYOK is currently disabled — render nothing. Hooks below stay on the
  // call path so React's rules-of-hooks linter is satisfied; with the flag
  // off this early return ships before any UI is created.
  if (!BYOK_ENABLED) return null;
  return <CompactModelPickerImpl />;
}

function CompactModelPickerImpl() {
  const providerId = useByokStore((s) => s.providerId);
  const modelId = useByokStore((s) => s.modelId);
  const setModel = useByokStore((s) => s.setModel);
  const fetchedModels = useByokStore((s) => s.fetchedModels);
  const fetchModels = useByokStore((s) => s.fetchModels);
  const apiKeys = useByokStore((s) => s.apiKeys);
  const fetchModelsError = useByokStore((s) => s.fetchModelsError);

  // Auto-fetch models if provider supports it and we don't have cached results
  useEffect(() => {
    if (!providerId) return;
    const config = PROVIDER_CONFIGS[providerId];
    if (!config.listModels) return;
    if (fetchedModels[providerId]?.length) return;
    const key = apiKeys[providerId] ?? "";
    if (config.requiresApiKey && !key) return;
    void fetchModels();
  }, [providerId, fetchedModels, fetchModels, apiKeys]);

  const models = useMemo(() => {
    if (!providerId) return [];
    const fetched = fetchedModels[providerId];
    if (fetched?.length) return fetched;
    return PROVIDER_CONFIGS[providerId].models;
  }, [fetchedModels, providerId]);

  if (models.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <Select
        value={modelId ?? ""}
        onValueChange={(v) => {
          if (v) setModel(v);
        }}
      >
        <SelectTrigger className="h-6 border-none shadow-none text-[11px] gap-1 px-1.5 hover:bg-accent w-auto">
          <SelectValue placeholder="Model..." />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fetchModelsError && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Failed to fetch models"
                className="flex items-center text-amber-600 hover:text-amber-700"
                onClick={() => {
                  void fetchModels();
                }}
              >
                <IconAlertTriangle className="h-3.5 w-3.5" />
              </button>
            }
          />
          <TooltipContent>
            Failed to fetch models: {fetchModelsError}. Showing built-in list. Click to retry.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
