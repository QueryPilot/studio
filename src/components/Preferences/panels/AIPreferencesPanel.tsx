import { useState, useEffect, useMemo, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLoader2,
} from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore } from "@/stores/acpStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import type { ProviderId } from "@/ai/types";
import { cn } from "@/lib/utils";

export default function AIPreferencesPanel() {
  // --- BYOK store selectors (atomic) ---
  const runtimeMode = useByokStore((s) => s.runtimeMode);
  const setRuntimeMode = useByokStore((s) => s.setRuntimeMode);
  const providerId = useByokStore((s) => s.providerId);
  const setProvider = useByokStore((s) => s.setProvider);
  const modelId = useByokStore((s) => s.modelId);
  const setModel = useByokStore((s) => s.setModel);
  const session = useByokStore((s) => s.session);
  const initSession = useByokStore((s) => s.initSession);
  const apiKey = useByokStore((s) => s.apiKey);
  const setApiKey = useByokStore((s) => s.setApiKey);
  const maxToolSteps = useByokStore((s) => s.maxToolSteps);
  const setMaxToolSteps = useByokStore((s) => s.setMaxToolSteps);
  const autoExecuteQueries = useByokStore((s) => s.autoExecuteQueries);
  const setAutoExecuteQueries = useByokStore((s) => s.setAutoExecuteQueries);
  const includeSchemaContext = useByokStore((s) => s.includeSchemaContext);
  const setIncludeSchemaContext = useByokStore((s) => s.setIncludeSchemaContext);

  // --- ACP store selectors (atomic) ---
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const selectAgent = useAcpStore((s) => s.selectAgent);
  const isLoadingAgents = useAcpStore((s) => s.isLoadingAgents);

  // --- Local state ---
  const [showKey, setShowKey] = useState(false);

  // Derived: current provider config
  const config = providerId ? PROVIDER_CONFIGS[providerId] : null;

  // Derived: split agents into installed and available-to-install
  const installedAgents = useMemo(
    () => availableAgents.filter((a) => a.installed),
    [availableAgents],
  );
  const availableToInstall = useMemo(
    () => availableAgents.filter((a) => !a.installed),
    [availableAgents],
  );

  // --- Handlers ---
  const handleRuntimeChange = (value: string) => {
    setRuntimeMode(value as "acp" | "byok");
  };

  // Auto-connect for providers that don't require an API key (e.g., Ollama)
  useEffect(() => {
    if (runtimeMode !== "byok" || !providerId || !modelId) return;
    const providerConfig = PROVIDER_CONFIGS[providerId];
    if (!providerConfig.requiresApiKey && !session) {
      initSession();
    }
  }, [runtimeMode, providerId, modelId, session, initSession]);

  // Derived: whether current session matches current provider/model selection
  const isSessionReady =
    session !== null &&
    session.providerId === providerId &&
    session.modelId === modelId;

  const handleConnect = useCallback(() => {
    initSession(apiKey || undefined);
  }, [initSession, apiKey]);

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4">
      {/* Sticky header */}
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">AI Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure the AI assistant runtime, provider, and behavior
        </p>
      </div>

      {/* Section 1: Runtime Mode */}
      <div className="space-y-3">
        <Label className="text-base">Runtime</Label>
        <p className="text-xs text-muted-foreground">
          Choose how the AI assistant connects to language models
        </p>
        <RadioGroup
          value={runtimeMode}
          onValueChange={handleRuntimeChange}
          className="space-y-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="acp" id="acp" />
            <Label htmlFor="acp" className="font-normal cursor-pointer">
              Agent (ACP)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="byok" id="byok" />
            <Label htmlFor="byok" className="font-normal cursor-pointer">
              Bring Your Own Key
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Section 2: ACP Agent Config */}
      {runtimeMode === "acp" && (
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-base">Agent</Label>
          {isLoadingAgents ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading agents...
            </div>
          ) : installedAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">
              No agents installed. Install an agent to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {installedAgents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => { selectAgent(agent.id); }}
                  className={cn(
                    "flex items-center gap-3 py-3 px-4 border rounded-xl cursor-pointer transition-colors",
                    agent.id === selectedAgentId
                      ? "border-primary bg-primary/5"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="text-sm font-medium flex-1">
                    {agent.name}
                  </span>
                  {agent.id === selectedAgentId && (
                    <IconCheck className="h-4 w-4 text-primary" />
                  )}
                </div>
              ))}
            </div>
          )}
          {availableToInstall.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {availableToInstall.length} more agent
              {availableToInstall.length !== 1 ? "s" : ""} available to install
            </p>
          )}
        </div>
      )}

      {/* Section 3: BYOK Provider Config */}
      {runtimeMode === "byok" && (
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-base">Provider</Label>

          {/* Provider dropdown */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Provider</Label>
            <Select
              value={providerId ?? ""}
              onValueChange={(v) => {
                if (v && v in PROVIDER_CONFIGS) {
                  setProvider(v as ProviderId);
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a provider..." />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PROVIDER_CONFIGS).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key (if required) */}
          {config?.requiresApiKey && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">API Key</Label>
              <div className="flex gap-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); }}
                  placeholder={`Enter ${config.name} API key...`}
                  className="h-8 text-xs font-mono"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => { setShowKey(!showKey); }}
                >
                  {showKey ? (
                    <IconEyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <IconEye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* No API key note for local providers */}
          {config && !config.requiresApiKey && (
            <p className="text-[11px] text-muted-foreground">
              No API key needed — runs locally on your machine.
            </p>
          )}

          {/* Model dropdown */}
          {config && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">Model</Label>
                {isSessionReady && (
                  <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                    Ready
                  </span>
                )}
              </div>
              <Select
                value={modelId ?? ""}
                onValueChange={(value) => {
                  if (value != null) {
                    setModel(value);
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a model..." />
                </SelectTrigger>
                <SelectContent>
                  {config.models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      <span>{m.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {m.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Connect button for key-based providers */}
          {config?.requiresApiKey && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleConnect}
              disabled={!apiKey}
            >
              {isSessionReady ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-green-500 mr-1.5" />
                  Connected
                </>
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      )}

      {/* Section 4: Behavior (always shown) */}
      <div className="space-y-3 pt-4 border-t">
        <Label className="text-base">Behavior</Label>
        <p className="text-xs text-muted-foreground">
          Configure how the AI assistant interacts with your databases
        </p>

        {/* Max Tool Steps */}
        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">Max Tool Steps</Label>
            <p className="text-xs text-muted-foreground">
              Maximum number of tool calls per response (1-10)
            </p>
          </div>
          <Input
            type="number"
            min={1}
            max={10}
            value={maxToolSteps}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setMaxToolSteps(v);
            }}
            className="w-16 h-8 text-xs"
          />
        </div>

        {/* Auto-execute queries */}
        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">Auto-execute Queries</Label>
            <p className="text-xs text-muted-foreground">
              Allow AI to run SQL queries automatically using tools
            </p>
          </div>
          <Switch
            checked={autoExecuteQueries}
            onCheckedChange={setAutoExecuteQueries}
          />
        </div>

        {/* Include schema context */}
        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">
              Include Schema Context
            </Label>
            <p className="text-xs text-muted-foreground">
              Send database schema with each message (uses more tokens)
            </p>
          </div>
          <Switch
            checked={includeSchemaContext}
            onCheckedChange={setIncludeSchemaContext}
          />
        </div>
      </div>
    </div>
  );
}
