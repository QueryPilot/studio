import { useState, useEffect, useMemo, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconRefresh,
  IconRobot,
  IconKey,
  IconBolt,
  IconWand,
} from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore } from "@/stores/acpStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import type { ProviderId, ProviderModelInfo } from "@/ai/types";
import { cn } from "@/lib/utils";

// Provider logo path map (Mistral has no logo asset, uses text fallback)
const PROVIDER_LOGOS: Record<ProviderId, string | null> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/claude-color.svg",
  google: "/logos/gemini-color.svg",
  mistral: null,
  ollama: "/logos/ollama.svg",
};

function ProviderLogo({
  providerId,
  size = 24,
}: {
  providerId: ProviderId;
  size?: number;
}) {
  const logo = PROVIDER_LOGOS[providerId];
  if (logo) {
    return (
      <img
        src={logo}
        alt={PROVIDER_CONFIGS[providerId].name}
        width={size}
        height={size}
        className="object-contain"
      />
    );
  }
  // Mistral text fallback
  return (
    <div
      className="flex items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold text-xs"
      style={{ width: size, height: size }}
    >
      M
    </div>
  );
}

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
  const apiKeys = useByokStore((s) => s.apiKeys);
  const setApiKey = useByokStore((s) => s.setApiKey);
  const fetchModels = useByokStore((s) => s.fetchModels);
  const fetchedModels = useByokStore((s) => s.fetchedModels);
  const isFetchingModels = useByokStore((s) => s.isFetchingModels);
  const apiKey = providerId ? (apiKeys[providerId] ?? "") : "";
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

  // Derived: models to display (fetched override static)
  const displayModels: ProviderModelInfo[] = useMemo(() => {
    if (providerId && fetchedModels[providerId]?.length) {
      return fetchedModels[providerId];
    }
    return config?.models ?? [];
  }, [providerId, fetchedModels, config]);

  // Derived: whether fetching is available for current provider
  const canFetchModels = config?.listModels != null;

  // Derived: split agents
  const installedAgents = useMemo(
    () => availableAgents.filter((a) => a.installed),
    [availableAgents],
  );
  const availableToInstall = useMemo(
    () => availableAgents.filter((a) => !a.installed),
    [availableAgents],
  );

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
    initSession(apiKey);
  }, [initSession, apiKey]);

  const handleFetchModels = useCallback(() => {
    void fetchModels();
  }, [fetchModels]);

  return (
    <div className="max-w-2xl space-y-8 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4 pb-8">
      {/* Header */}
      <div className="sticky top-0 bg-background z-10 pb-3">
        <h2 className="text-base font-semibold tracking-tight">AI</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure the AI assistant runtime, provider, and behavior
        </p>
      </div>

      {/* Section 1: Runtime Mode — two visual cards */}
      <section className="space-y-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Runtime
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setRuntimeMode("acp"); }}
            className={cn(
              "group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
              runtimeMode === "acp"
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-muted-foreground/30 hover:bg-accent/50",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                runtimeMode === "acp"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <IconRobot className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">Agent (ACP)</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Managed AI agents with built-in tools
              </div>
            </div>
            {runtimeMode === "acp" && (
              <div className="absolute top-3 right-3">
                <IconCheck className="h-4 w-4 text-primary" />
              </div>
            )}
          </button>

          <button
            onClick={() => { setRuntimeMode("byok"); }}
            className={cn(
              "group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
              runtimeMode === "byok"
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-muted-foreground/30 hover:bg-accent/50",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                runtimeMode === "byok"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <IconKey className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">Bring Your Own Key</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Connect with your own API keys
              </div>
            </div>
            {runtimeMode === "byok" && (
              <div className="absolute top-3 right-3">
                <IconCheck className="h-4 w-4 text-primary" />
              </div>
            )}
          </button>
        </div>
      </section>

      {/* Section 2: ACP Agent Config */}
      {runtimeMode === "acp" && (
        <section className="space-y-3">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agent
          </Label>
          {isLoadingAgents ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              Loading agents...
            </div>
          ) : installedAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-xl">
              <IconRobot className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                No agents installed
              </p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Install an agent to get started
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {installedAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => { selectAgent(agent.id); }}
                  className={cn(
                    "w-full flex items-center gap-3 py-3 px-4 rounded-xl text-left transition-all",
                    agent.id === selectedAgentId
                      ? "bg-primary/5 border border-primary shadow-sm"
                      : "border border-transparent hover:bg-accent/50 hover:border-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                      agent.id === selectedAgentId
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <IconRobot className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium flex-1 truncate">
                    {agent.name}
                  </span>
                  {agent.id === selectedAgentId && (
                    <IconCheck className="h-4 w-4 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
          {availableToInstall.length > 0 && (
            <p className="text-xs text-muted-foreground pl-1">
              {availableToInstall.length} more agent
              {availableToInstall.length !== 1 ? "s" : ""} available to install
            </p>
          )}
        </section>
      )}

      {/* Section 3: BYOK Provider & Model Config */}
      {runtimeMode === "byok" && (
        <>
          {/* Provider cards */}
          <section className="space-y-3">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Provider
            </Label>
            <div className="grid grid-cols-5 gap-2">
              {Object.values(PROVIDER_CONFIGS).map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProvider(p.id); }}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border py-3 px-2 transition-all",
                    p.id === providerId
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-muted-foreground/30 hover:bg-accent/50",
                  )}
                >
                  <ProviderLogo providerId={p.id} size={28} />
                  <span
                    className={cn(
                      "text-[11px] font-medium truncate max-w-full",
                      p.id === providerId
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* API Key */}
          {config?.requiresApiKey && (
            <section className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                API Key
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); }}
                    placeholder={`Enter your ${config.name} API key...`}
                    className="h-9 text-xs font-mono pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setShowKey(!showKey); }}
                  >
                    {showKey ? (
                      <IconEyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <IconEye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <Button
                  size="sm"
                  className="h-9 px-4 text-xs"
                  onClick={handleConnect}
                  disabled={!apiKey}
                  variant={isSessionReady ? "outline" : "default"}
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
              </div>
            </section>
          )}

          {/* Local provider note */}
          {config && !config.requiresApiKey && (
            <p className="text-xs text-muted-foreground">
              No API key needed — connects to local server on your machine.
            </p>
          )}

          {/* Model selection — scrollable list */}
          {config && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Model
                </Label>
                <div className="flex items-center gap-2">
                  {isSessionReady && (
                    <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                      Ready
                    </span>
                  )}
                  {canFetchModels && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                      onClick={handleFetchModels}
                      disabled={
                        isFetchingModels ||
                        (config.requiresApiKey && !apiKey)
                      }
                    >
                      {isFetchingModels ? (
                        <IconLoader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <IconRefresh className="h-3 w-3" />
                      )}
                      {isFetchingModels ? "Fetching..." : "Fetch models"}
                    </Button>
                  )}
                </div>
              </div>

              <ScrollArea className="h-[220px] rounded-xl border">
                <div className="p-1">
                  {displayModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModel(m.id); }}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                        m.id === modelId
                          ? "bg-primary/8 text-foreground"
                          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          m.id === modelId
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {m.id === modelId && (
                          <IconCheck className="h-2.5 w-2.5 text-primary-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {m.name}
                        </div>
                        {m.description && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {m.description}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                  {displayModels.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <IconWand className="h-6 w-6 text-muted-foreground/40 mb-1.5" />
                      <p className="text-xs text-muted-foreground">
                        {config.requiresApiKey && !apiKey
                          ? "Enter an API key to fetch models"
                          : "No models available"}
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </section>
          )}
        </>
      )}

      {/* Section 4: Behavior */}
      <section className="space-y-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Behavior
        </Label>

        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconBolt className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">
                Auto-execute Queries
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Allow AI to run SQL queries automatically
              </p>
            </div>
          </div>
          <Switch
            checked={autoExecuteQueries}
            onCheckedChange={setAutoExecuteQueries}
          />
        </div>

        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconWand className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">
                Include Schema Context
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Send database schema with each message
              </p>
            </div>
          </div>
          <Switch
            checked={includeSchemaContext}
            onCheckedChange={setIncludeSchemaContext}
          />
        </div>
      </section>
    </div>
  );
}
