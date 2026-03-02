import { useState, useEffect, useMemo, useCallback } from "react";
import { useTheme } from "@/components/theme-provider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconArrowUp,
  IconBolt,
  IconCheck,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconKey,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconTerminal2,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore } from "@/stores/acpStore";
import { AcpService } from "@/services/acpService";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import type { ProviderId, ProviderModelInfo } from "@/ai/types";
import type { AgentInfo, PackageInfo, NpmPackageManager } from "@/types/acp";
import { cn } from "@/lib/utils";

// Provider logo path map (Mistral has no logo asset, uses text fallback)
const PROVIDER_LOGOS: Record<ProviderId, string | null> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/claude-color.svg",
  google: "/logos/gemini-color.svg",
  mistral: null,
  ollama: "/logos/ollama.svg",
};

// Agent logo mappings
const AGENT_LOGOS: Record<string, { light: string; dark: string }> = {
  "claude-code-acp": { light: "/logos/claude-color.svg", dark: "/logos/claude-color.svg" },
  "gemini": { light: "/logos/gemini-color.svg", dark: "/logos/gemini-color.svg" },
  "codex-acp": { light: "/logos/openai.svg", dark: "/logos/openai.svg" },
  "opencode": { light: "/logos/opencode-logo-light.svg", dark: "/logos/opencode-logo-dark.svg" },
};

const NPM_MANAGERS: { value: NpmPackageManager; label: string }[] = [
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "yarn", label: "yarn" },
  { value: "bun", label: "bun" },
];

type InstallStatus = "idle" | "installing" | "success" | "error";

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
  return (
    <div
      className="flex items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold text-xs"
      style={{ width: size, height: size }}
    >
      M
    </div>
  );
}

function AgentLogo({ agentId, size = 20 }: { agentId: string; size?: number }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const logos = AGENT_LOGOS[agentId];
  const logo = logos ? (isDark ? logos.dark : logos.light) : null;

  if (logo) {
    return <img src={logo} alt="" width={size} height={size} className="object-contain max-h-5" />;
  }
  return <IconSparkles className="text-muted-foreground" style={{ width: size, height: size }} />;
}

export default function AIPreferencesPanel() {
  // --- BYOK store ---
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
  const fetchModelsError = useByokStore((s) => s.fetchModelsError);
  const apiKey = providerId ? (apiKeys[providerId] ?? "") : "";
  const autoExecuteQueries = useByokStore((s) => s.autoExecuteQueries);
  const setAutoExecuteQueries = useByokStore((s) => s.setAutoExecuteQueries);
  const includeSchemaContext = useByokStore((s) => s.includeSchemaContext);
  const setIncludeSchemaContext = useByokStore((s) => s.setIncludeSchemaContext);

  // --- ACP store ---
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const selectAgent = useAcpStore((s) => s.selectAgent);
  const isLoadingAgents = useAcpStore((s) => s.isLoadingAgents);
  const agentsWithUpdates = useAcpStore((s) => s.agentsWithUpdates);
  const preferredPackageManager = useAcpStore((s) => s.preferredPackageManager);
  const setPreferredPackageManager = useAcpStore((s) => s.setPreferredPackageManager);
  const loadAgents = useAcpStore((s) => s.loadAgents);
  const checkForUpdates = useAcpStore((s) => s.checkForUpdates);

  // --- Local state ---
  const [showKey, setShowKey] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [packageStates, setPackageStates] = useState<
    Record<string, { status: InstallStatus; error?: string }>
  >({});

  const config = providerId ? PROVIDER_CONFIGS[providerId] : null;

  const displayModels: ProviderModelInfo[] = useMemo(() => {
    if (providerId && fetchedModels[providerId]?.length) {
      return fetchedModels[providerId];
    }
    return config?.models ?? [];
  }, [providerId, fetchedModels, config]);

  const canFetchModels = config?.listModels != null;

  const hasNpmPackages = useMemo(
    () => availableAgents.some((a) => a.packages.some((p) => p.managerType === "npm")),
    [availableAgents],
  );

  // Auto-connect for providers that don't require an API key
  useEffect(() => {
    if (runtimeMode !== "byok" || !providerId || !modelId) return;
    const providerConfig = PROVIDER_CONFIGS[providerId];
    if (!providerConfig.requiresApiKey && !session) {
      initSession();
    }
  }, [runtimeMode, providerId, modelId, session, initSession]);

  // Auto-fetch models when provider is selected and conditions are met
  useEffect(() => {
    if (!providerId) return;
    const providerConfig = PROVIDER_CONFIGS[providerId];
    if (!providerConfig.listModels) return;
    // Already have fetched models for this provider
    if (fetchedModels[providerId]?.length) return;
    // For providers requiring API key, only fetch if key is available
    if (providerConfig.requiresApiKey && !apiKey) return;
    void fetchModels();
  }, [providerId, apiKey, fetchedModels, fetchModels]);

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

  const handleInstallPackage = useCallback(
    async (pkg: PackageInfo, agentId: string) => {
      setPackageStates((prev) => ({
        ...prev,
        [pkg.name]: { status: "installing" },
      }));

      try {
        const pm = pkg.managerType === "brew" ? "brew" : preferredPackageManager;

        if (pkg.updateAvailable) {
          const binaryName = agentId === "codex-acp" ? "codex" : "claude";
          await AcpService.upgradePackage(
            pkg.name,
            pkg.managerType,
            binaryName,
            pkg.managerType === "npm" ? pm as NpmPackageManager : undefined,
          );
        } else {
          await AcpService.installPackage(pkg.name, pkg.managerType, pm);
        }

        setPackageStates((prev) => ({
          ...prev,
          [pkg.name]: { status: "success" },
        }));

        // Refresh agents after successful install
        void loadAgents();
      } catch (err) {
        setPackageStates((prev) => ({
          ...prev,
          [pkg.name]: {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [preferredPackageManager, loadAgents],
  );

  // Check if agent has updates
  const hasUpdates = useCallback(
    (agentId: string) => agentsWithUpdates.some((a) => a.id === agentId),
    [agentsWithUpdates],
  );

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingUpdates(true);
    try {
      await checkForUpdates();
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [checkForUpdates]);

  const handleInstallAgent = useCallback(
    async (agent: AgentInfo) => {
      for (const pkg of agent.packages) {
        if (!pkg.installed) {
          await handleInstallPackage(pkg, agent.id);
        }
      }
    },
    [handleInstallPackage],
  );

  const handleUpdateAgent = useCallback(
    async (agentId: string, packages: PackageInfo[]) => {
      for (const pkg of packages) {
        if (pkg.updateAvailable) {
          await handleInstallPackage(pkg, agentId);
        }
      }
    },
    [handleInstallPackage],
  );

  // Get agent with update info (merged packages with update state)
  const getAgentPackages = useCallback(
    (agentId: string) => {
      const updateAgent = agentsWithUpdates.find((a) => a.id === agentId);
      const agent = availableAgents.find((a) => a.id === agentId);
      return (updateAgent ?? agent)?.packages ?? [];
    },
    [agentsWithUpdates, availableAgents],
  );

  return (
    <div className="max-w-2xl space-y-8 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4 pb-8">
      {/* Header */}
      <div className="sticky top-0 bg-background z-10 pb-3">
        <h2 className="text-base font-semibold tracking-tight">AI</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure the AI assistant runtime, provider, and behavior
        </p>
      </div>

      {/* CLI Agents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2.5 cursor-pointer select-none"
            onClick={() => { setRuntimeMode("acp"); }}
          >
            <div className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 transition-colors",
              runtimeMode === "acp" ? "border-primary" : "border-muted-foreground/30",
            )}>
              {runtimeMode === "acp" && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </div>
            <IconTerminal2 className={cn("h-4 w-4", runtimeMode === "acp" ? "text-primary" : "text-muted-foreground")} />
            <Label className={cn(
              "text-xs font-medium uppercase tracking-wider cursor-pointer",
              runtimeMode === "acp" ? "text-foreground" : "text-muted-foreground",
            )}>
              CLI Agents
            </Label>
          </div>
          {hasNpmPackages && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">via</span>
              <Select
                value={preferredPackageManager}
                onValueChange={(v) => { setPreferredPackageManager(v as NpmPackageManager); }}
              >
                <SelectTrigger className="h-6 w-20 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NPM_MANAGERS.map((pm) => (
                    <SelectItem key={pm.value} value={pm.value} className="text-xs">
                      {pm.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {isLoadingAgents ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            Loading agents...
          </div>
        ) : availableAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-xl">
            <IconTerminal2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No agents found</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Install a CLI agent to get started
            </p>
          </div>
        ) : (
          <div className="rounded-xl border divide-y">
            {availableAgents.map((agent) => {
              const packages = getAgentPackages(agent.id);
              const isSelected = agent.id === selectedAgentId;
              const agentHasUpdates = hasUpdates(agent.id);

              return (
                <div key={agent.id}>
                  {/* Agent row */}
                  <div
                    onClick={() => { if (agent.installed) selectAgent(agent.id); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      agent.installed ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
                      isSelected && "bg-primary/5",
                    )}
                  >
                    <AgentLogo agentId={agent.id} size={18} />
                    <span className={cn(
                      "text-xs font-medium",
                      isSelected ? "text-foreground" : "text-muted-foreground",
                    )}>
                      {agent.name}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1.5">
                      {!agent.installed ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleInstallAgent(agent);
                          }}
                          disabled={packages.some((p) => packageStates[p.name]?.status === "installing")}
                        >
                          {packages.some((p) => packageStates[p.name]?.status === "installing") ? (
                            <IconLoader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <IconDownload className="h-3 w-3" />
                          )}
                          Install
                        </Button>
                      ) : agentHasUpdates ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1 text-amber-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleUpdateAgent(agent.id, packages);
                          }}
                          disabled={packages.some((p) => packageStates[p.name]?.status === "installing")}
                        >
                          {packages.some((p) => packageStates[p.name]?.status === "installing") ? (
                            <IconLoader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <IconArrowUp className="h-3 w-3" />
                          )}
                          Update
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1 text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCheckForUpdates();
                          }}
                          disabled={isCheckingUpdates}
                        >
                          {isCheckingUpdates ? (
                            <IconLoader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <IconRefresh className="h-3 w-3" />
                          )}
                          Check updates
                        </Button>
                      )}
                      {isSelected && <IconCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </div>
                  </div>

                  {/* Compact package sub-rows */}
                  {packages.length > 0 && (
                    <div className="pb-2">
                      {packages.map((pkg) => {
                        const state = packageStates[pkg.name] ?? { status: "idle" as InstallStatus };
                        const isInstalled = pkg.installed || state.status === "success";
                        const needsUpdate = pkg.updateAvailable && state.status !== "success";
                        const isDone = isInstalled && !needsUpdate;

                        return (
                          <div
                            key={pkg.name}
                            className={cn(
                              "flex items-center gap-2 pl-9 pr-3 py-0.5",
                              state.status === "error" && "bg-destructive/5",
                            )}
                          >
                            <code className="text-[10px] font-mono text-muted-foreground truncate">
                              {pkg.name}
                            </code>
                            {isDone && pkg.installedVersion && (
                              <span className="text-[10px] font-mono text-muted-foreground/50">
                                {pkg.installedVersion}
                              </span>
                            )}
                            {needsUpdate && pkg.installedVersion && pkg.latestVersion && (
                              <span className="text-[10px] font-mono text-amber-500">
                                {pkg.installedVersion} → {pkg.latestVersion}
                              </span>
                            )}
                            <div className="flex-1" />
                            {state.status === "error" && state.error && (
                              <span className="text-[10px] text-destructive truncate max-w-32">
                                {state.error}
                              </span>
                            )}
                            {isDone ? (
                              <IconCheck className="h-3 w-3 text-green-500 shrink-0" />
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] shrink-0"
                                onClick={() => void handleInstallPackage(pkg, agent.id)}
                                disabled={state.status === "installing"}
                              >
                                {state.status === "installing" ? (
                                  <IconLoader2 className="h-3 w-3 animate-spin" />
                                ) : state.status === "error" ? (
                                  <><IconX className="h-3 w-3 text-destructive" /><span className="ml-0.5">Retry</span></>
                                ) : needsUpdate ? (
                                  <><IconArrowUp className="h-3 w-3 text-amber-500" /><span className="ml-0.5">Update</span></>
                                ) : (
                                  <><IconDownload className="h-3 w-3" /><span className="ml-0.5">Install</span></>
                                )}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SDK Agent */}
      <section className="space-y-3">
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none"
          onClick={() => { setRuntimeMode("byok"); }}
        >
          <div className={cn(
            "flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 transition-colors",
            runtimeMode === "byok" ? "border-primary" : "border-muted-foreground/30",
          )}>
            {runtimeMode === "byok" && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </div>
          <IconKey className={cn("h-4 w-4", runtimeMode === "byok" ? "text-primary" : "text-muted-foreground")} />
          <Label className={cn(
            "text-xs font-medium uppercase tracking-wider cursor-pointer",
            runtimeMode === "byok" ? "text-foreground" : "text-muted-foreground",
          )}>
            SDK Agent
          </Label>
        </div>

        {/* Provider cards */}
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
              <span className={cn(
                "text-[11px] font-medium truncate max-w-full",
                p.id === providerId ? "text-foreground" : "text-muted-foreground",
              )}>
                {p.name}
              </span>
            </button>
          ))}
        </div>

        {/* API Key */}
        {config?.requiresApiKey && (
          <div className="space-y-2">
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
                  {showKey ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
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
          </div>
        )}

        {config && !config.requiresApiKey && (
          <p className="text-xs text-muted-foreground">
            No API key needed — connects to local server on your machine.
          </p>
        )}

        {/* Model selection — flat list */}
        {config && (
          <div className="space-y-2">
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
                    disabled={isFetchingModels || (config.requiresApiKey && !apiKey)}
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

            <div className="rounded-xl border divide-y">
              {displayModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setModel(m.id); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors first:rounded-t-xl last:rounded-b-xl",
                    m.id === modelId
                      ? "bg-primary/5"
                      : "hover:bg-accent/50",
                  )}
                >
                  <span className={cn(
                    "text-xs font-medium",
                    m.id === modelId ? "text-foreground" : "text-muted-foreground",
                  )}>
                    {m.name}
                  </span>
                  {m.description && (
                    <span className="text-[11px] text-muted-foreground/60 truncate">
                      {m.description}
                    </span>
                  )}
                  <div className="flex-1" />
                  {m.id === modelId && (
                    <IconCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </button>
              ))}
              {displayModels.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
                  {isFetchingModels ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      Fetching models...
                    </div>
                  ) : fetchModelsError ? (
                    <>
                      <p className="text-xs text-destructive">{fetchModelsError}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-3 text-[11px] gap-1"
                        onClick={handleFetchModels}
                      >
                        <IconRefresh className="h-3 w-3" />
                        Retry
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {config.requiresApiKey && !apiKey
                        ? "Enter an API key to fetch models"
                        : canFetchModels
                          ? "Click Fetch models to load available models"
                          : "No models available"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Behavior */}
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
              <Label className="text-xs font-medium">Auto-execute Queries</Label>
              <p className="text-[11px] text-muted-foreground">
                Allow AI to run SQL queries automatically
              </p>
            </div>
          </div>
          <Switch checked={autoExecuteQueries} onCheckedChange={setAutoExecuteQueries} />
        </div>

        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
              <IconWand className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">Include Schema Context</Label>
              <p className="text-[11px] text-muted-foreground">
                Send database schema with each message
              </p>
            </div>
          </div>
          <Switch checked={includeSchemaContext} onCheckedChange={setIncludeSchemaContext} />
        </div>
      </section>
    </div>
  );
}
