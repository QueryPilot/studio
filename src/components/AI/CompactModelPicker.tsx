/**
 * Compact Model Picker
 *
 * Inline model/agent selector for the AI panel input footer.
 * Renders differently based on runtime mode (ACP vs BYOK)
 * and session state.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconRobot, IconSettings } from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore } from "@/stores/acpStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";

export function CompactModelPicker() {
  const runtimeMode = useByokStore((s) => s.runtimeMode);
  const providerId = useByokStore((s) => s.providerId);
  const modelId = useByokStore((s) => s.modelId);
  const session = useByokStore((s) => s.session);
  const setModel = useByokStore((s) => s.setModel);
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const openPreferences = usePreferencesStore((s) => s.openPreferences);

  // ACP mode: show agent pill
  if (runtimeMode === "acp") {
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2"
        onClick={() => { openPreferences("ai"); }}
      >
        <IconRobot className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px]">{agent?.name ?? "Select agent..."}</span>
      </Button>
    );
  }

  // BYOK mode: no session -> configure link
  if (!session || !providerId) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-muted-foreground"
        onClick={() => { openPreferences("ai"); }}
      >
        <IconSettings className="h-3 w-3" />
        <span className="text-[11px]">Configure AI...</span>
      </Button>
    );
  }

  // BYOK mode: session active -> model dropdown + settings
  const config = PROVIDER_CONFIGS[providerId];
  return (
    <div className="flex items-center gap-0.5">
      <Select
        value={modelId ?? ""}
        onValueChange={(v) => {
          if (v) setModel(v);
        }}
      >
        <SelectTrigger className="h-6 border-none shadow-none text-[11px] gap-1 px-1.5 hover:bg-accent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {config.models.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => { openPreferences("ai"); }}
      >
        <IconSettings className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}
