/**
 * Compact Model Picker (BYOK only)
 *
 * Inline model dropdown for BYOK mode in the AI panel footer.
 * For ACP mode, use ModelSelector instead.
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
import { PROVIDER_CONFIGS } from "@/ai/providers";

export function CompactModelPicker() {
  const providerId = useByokStore((s) => s.providerId);
  const modelId = useByokStore((s) => s.modelId);
  const setModel = useByokStore((s) => s.setModel);
  const fetchedModels = useByokStore((s) => s.fetchedModels);

  const models = useMemo(() => {
    if (!providerId) return [];
    const fetched = fetchedModels[providerId];
    if (fetched?.length) return fetched;
    return PROVIDER_CONFIGS[providerId].models;
  }, [fetchedModels, providerId]);

  if (models.length === 0) return null;

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
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
