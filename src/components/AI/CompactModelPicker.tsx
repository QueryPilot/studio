/**
 * Compact Model Picker
 *
 * Inline model selector for the AI panel input footer.
 * Shows model dropdown for both ACP and BYOK modes.
 * AgentSelector handles runtime/agent switching separately.
 */

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore, useAvailableModels } from "@/stores/acpStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";

export function CompactModelPicker() {
  const runtimeMode = useByokStore((s) => s.runtimeMode);
  const providerId = useByokStore((s) => s.providerId);
  const modelId = useByokStore((s) => s.modelId);
  const setModel = useByokStore((s) => s.setModel);
  const fetchedModels = useByokStore((s) => s.fetchedModels);
  const selectedModel = useAcpStore((s) => s.selectedModel);
  const selectAcpModel = useAcpStore((s) => s.selectModel);
  const acpModels = useAvailableModels();

  // BYOK models (fetched override static)
  const byokModels = useMemo(() => {
    if (!providerId) return [];
    const fetched = fetchedModels[providerId];
    if (fetched?.length) return fetched;
    return PROVIDER_CONFIGS[providerId].models;
  }, [fetchedModels, providerId]);

  // ACP mode: show ACP model dropdown
  if (runtimeMode === "acp") {
    if (acpModels.length === 0) return null;

    return (
      <Select
        value={selectedModel ?? ""}
        onValueChange={(v) => {
          if (v) void selectAcpModel(v);
        }}
      >
        <SelectTrigger className="h-6 border-none shadow-none text-[11px] gap-1 px-1.5 hover:bg-accent w-auto">
          <SelectValue placeholder="Model..." />
        </SelectTrigger>
        <SelectContent>
          {acpModels.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // BYOK mode: show model dropdown (even without session)
  if (byokModels.length === 0) return null;

  return (
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
        {byokModels.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
