import { logger } from "@/lib/logger";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconCircleCheckFilled,
  IconCircleX,
  IconRefresh,
  IconExternalLink,
  IconRobot,
  IconSparkles,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  getChatProviders,
  getSidecarStatus,
  type AIProviderConfig,
} from "@/services/aiService";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAIChatStore } from "@/stores/aiChatStore";

export default function AIPanel() {
  // AI Chat Store
  const {
    providerDefaultModels,
    providerEnabledModels,
    setProviderDefaultModel,
    getProviderDefaultModel,
    toggleProviderModel,
    getProviderEnabledModels,
  } = useAIChatStore();

  // Provider state
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loadingProviders, setLoadingProviders] = useState(true);

  // API Key state
  const [currentApiKey, setCurrentApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Default model selection (local state for current provider)
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);

  // Sidecar status
  const [sidecarStatus, setSidecarStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

  // Load providers from sidecar
  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const [providersData, statusData] = await Promise.all([
        getChatProviders(),
        getSidecarStatus(),
      ]);

      setProviders(providersData);
      setConfiguredProviders(statusData?.configuredProviders || []);

      // Auto-select first provider or first configured provider
      if (providersData.length > 0 && !selectedProvider) {
        const firstConfigured = providersData.find((p) =>
          statusData?.configuredProviders.includes(p.name),
        );
        setSelectedProvider(firstConfigured?.name || providersData[0].name);
      }
    } catch (error) {
      logger.error("Failed to load providers:", error);
      toast.error("Failed to load AI providers");
    } finally {
      setLoadingProviders(false);
    }
  }, [selectedProvider]);

  // Load API key for selected provider
  const loadApiKey = useCallback(async () => {
    if (!selectedProvider) return;

    try {
      const key: string | null = await invoke("get_ai_api_key", {
        provider: selectedProvider,
      });
      setCurrentApiKey(key || "");
    } catch (error) {
      logger.error("Failed to load API key:", error);
      setCurrentApiKey("");
    }
  }, [selectedProvider]);

  // Check sidecar health
  const checkSidecarStatus = useCallback(async () => {
    setSidecarStatus("checking");
    try {
      const statusData = await getSidecarStatus();
      setSidecarStatus(statusData ? "online" : "offline");
    } catch (error) {
      logger.error("Failed to check sidecar status:", error);
      setSidecarStatus("offline");
    }
  }, []);

  // Save API key
  const handleSaveApiKey = async () => {
    setIsSaving(true);
    try {
      await invoke("set_ai_api_key", {
        provider: selectedProvider,
        apiKey: currentApiKey,
      });

      try {
        await invoke("reload_ai_api_keys");
        logger.info("✅ API keys reloaded in sidecar");

        // Small delay to ensure sidecar has reloaded
        await new Promise(resolve => setTimeout(resolve, 500));

        // Refresh configured providers
        const statusData = await getSidecarStatus();
        logger.info("✅ Status after reload:", statusData);
        setConfiguredProviders(statusData?.configuredProviders || []);

        // Force re-render by reloading providers
        await loadProviders();
      } catch (reloadError) {
        logger.error("Failed to reload API keys in sidecar:", reloadError);
      }

      toast.success(`${selectedProvider} API key saved and configured`);
    } catch (error) {
      logger.error("Failed to save API key:", error);
      toast.error("Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  };

  // Initial load
  useEffect(() => {
    void checkSidecarStatus();
    void loadProviders();
  }, [checkSidecarStatus, loadProviders]);

  // Load API key when provider changes
  useEffect(() => {
    if (selectedProvider) {
      void loadApiKey();
      // Load default model for this provider
      const defaultModel = getProviderDefaultModel(selectedProvider);
      if (defaultModel) {
        setSelectedModel(defaultModel);
      } else {
        // If no default, clear selection
        setSelectedModel("");
      }
    }
  }, [selectedProvider, loadApiKey, getProviderDefaultModel]);

  const currentProviderConfig = providers.find((p) => p.name === selectedProvider);
  const isProviderConfigured = configuredProviders.includes(selectedProvider);

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 p-1.5 rounded-lg">
              <IconRobot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">AI Assistant Configuration</h2>
              <p className="text-xs text-muted-foreground">
                Configure AI providers and manage API keys securely
              </p>
            </div>
          </div>

          {/* Sidecar Status */}
          <div className="flex items-center gap-3">
            {sidecarStatus === "checking" && (
              <Badge variant="secondary" className="gap-1.5 h-8">
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                Checking...
              </Badge>
            )}
            {sidecarStatus === "online" && (
              <Badge variant="default" className="gap-1.5 h-8 bg-green-600 hover:bg-green-700">
                <div className="w-2 h-2 bg-white rounded-full" />
                QP AI Server Online
              </Badge>
            )}
            {sidecarStatus === "offline" && (
              <Badge variant="destructive" className="gap-1.5 h-8">
                <IconCircleX className="h-3.5 w-3.5" />
                QP AI Server Offline
              </Badge>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void checkSidecarStatus();
                void loadProviders();
              }}
              disabled={sidecarStatus === "checking"}
              className="h-8 w-8"
            >
              <IconRefresh className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Separator />
      </div>

      {loadingProviders ? (
        <div className="flex items-center justify-center py-12 mt-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IconLoader2 className="h-5 w-5 animate-spin" />
            <span>Loading providers...</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4 mt-4">
          {/* Left Column: Provider List */}
          <div className="col-span-5">
            <div className="bg-muted/30 rounded-lg p-3 max-h-[calc(100vh-12rem)] overflow-y-auto">
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Available Providers</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select a provider to configure
                </p>
              </div>
              <div className="space-y-1.5">
                {providers.map((provider) => {
                  const isConfigured = configuredProviders.includes(provider.name);
                  const isSelected = selectedProvider === provider.name;
                  const defaultModelId = getProviderDefaultModel(provider.name);
                  const defaultModelInfo = defaultModelId
                    ? provider.models.find((m) => m.id === defaultModelId)
                    : null;
                  const enabledModels = getProviderEnabledModels(provider.name);
                  const enabledCount = enabledModels.length;
                  const totalCount = provider.models.length;

                  return (
                    <button
                      key={provider.name}
                      onClick={() => setSelectedProvider(provider.name)}
                      className={`w-full text-left p-2.5 rounded-md transition-all ${
                        isSelected
                          ? "bg-primary/10"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-0.5 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-semibold capitalize text-xs">
                              {provider.name}
                            </h3>
                            {isConfigured && (
                              <IconCircleCheckFilled className="h-3 w-3 text-green-600" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {enabledCount > 0
                              ? `${enabledCount}/${totalCount} models enabled`
                              : `${totalCount} models available`
                            }
                          </p>
                          {defaultModelInfo && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 h-3.5">
                                {defaultModelInfo.name}
                              </Badge>
                            </div>
                          )}
                        </div>
                        {provider.requiresApiKey && (
                          <Badge
                            variant={isConfigured ? "default" : "secondary"}
                            className="text-[10px] shrink-0"
                          >
                            {isConfigured ? "Configured" : "API Key Required"}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="sticky bottom-0 bg-muted/30 pt-2 -mx-3 px-3 pb-3 -mb-3">
                <Separator className="mb-2" />
                <Button
                  variant="outline"
                  className="w-full border-dashed text-xs h-8"
                  disabled
                >
                  <IconSparkles className="h-3.5 w-3.5 mr-2" />
                  Add Custom Provider
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column: Configuration Panel */}
          <div className="col-span-7">
            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
              <div className="mb-2">
                <h3 className="text-sm font-semibold capitalize">
                  {selectedProvider || "Select Provider"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {currentProviderConfig?.requiresApiKey
                    ? "Configure API key for this provider"
                    : "No API key required"}
                </p>
              </div>
              <div className="space-y-3">
                {currentProviderConfig ? (
                  <>
                    {/* Models List */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Available Models</Label>
                      <p className="text-xs text-muted-foreground">
                        Select models to enable (checked models will appear in model selector)
                      </p>
                      <div className="bg-accent/50 rounded-lg p-3 max-h-56 overflow-y-auto">
                        <div className="space-y-1.5">
                          {currentProviderConfig.models.map((modelInfo) => {
                            const enabledModels = getProviderEnabledModels(selectedProvider);
                            const isEnabled = enabledModels.includes(modelInfo.id);
                            const isDefault = selectedModel === modelInfo.id;

                            return (
                              <div
                                key={modelInfo.id}
                                className="group relative"
                                onMouseEnter={() => setHoveredModel(modelInfo.id)}
                                onMouseLeave={() => setHoveredModel(null)}
                              >
                                <button
                                  onClick={() => {
                                    toggleProviderModel(selectedProvider, modelInfo.id);
                                    toast.success(
                                      isEnabled
                                        ? `${modelInfo.name} disabled`
                                        : `${modelInfo.name} enabled`
                                    );
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors ${
                                    isDefault
                                      ? "bg-primary/20 text-primary"
                                      : isEnabled
                                      ? "bg-accent/50"
                                      : "hover:bg-accent/30 text-muted-foreground"
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    {/* Checkbox */}
                                    <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                                      isEnabled
                                        ? "border-primary bg-primary"
                                        : "border-muted-foreground"
                                    }`}>
                                      {isEnabled && (
                                        <IconCircleCheckFilled className="h-2.5 w-2.5 text-white" />
                                      )}
                                    </div>

                                    {/* Model Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`text-xs font-mono ${
                                          isDefault ? "font-semibold" : ""
                                        }`}>
                                          {modelInfo.name}
                                        </span>
                                        {isDefault && (
                                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                            Default
                                          </Badge>
                                        )}
                                      </div>

                                      {/* Context Window and Pricing */}
                                      <div className="flex items-center gap-2 mt-0.5">
                                        {modelInfo.contextWindow && (
                                          <span className="text-[10px] text-muted-foreground">
                                            {(modelInfo.contextWindow / 1000).toLocaleString()}K ctx
                                          </span>
                                        )}
                                        {modelInfo.pricing && (
                                          <span className="text-[10px] text-muted-foreground">
                                            ${modelInfo.pricing.input}/${modelInfo.pricing.output} per 1M
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </button>

                                {/* Set as Default button on hover (only for enabled models) */}
                                {hoveredModel === modelInfo.id && isEnabled && !isDefault && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedModel(modelInfo.id);
                                      setProviderDefaultModel(selectedProvider, modelInfo.id);
                                      toast.success(`${modelInfo.name} set as default`);
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 h-6 text-[10px] px-2"
                                  >
                                    Set as Default
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* API Key Configuration */}
                    {currentProviderConfig.requiresApiKey && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="api-key" className="text-xs font-medium">
                            API Key
                          </Label>
                          <div className="relative">
                            <Input
                              id="api-key"
                              type={showApiKey ? "text" : "password"}
                              value={currentApiKey}
                              onChange={(e) => setCurrentApiKey(e.target.value)}
                              placeholder={`Enter ${selectedProvider} API key`}
                              className="pr-10 font-mono text-xs h-9"
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showApiKey ? (
                                <IconEyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <IconEye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Stored securely in system keychain
                          </p>
                        </div>

                        <Button
                          onClick={handleSaveApiKey}
                          disabled={isSaving || !currentApiKey.trim()}
                          className="w-full h-8 text-xs"
                        >
                          {isSaving && (
                            <IconLoader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          )}
                          Save API Key
                        </Button>

                        {isProviderConfigured && (
                          <div className="flex items-center gap-2 text-xs text-green-600">
                            <IconCircleCheckFilled className="h-3.5 w-3.5" />
                            <span>Provider configured successfully</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Provider Links */}
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-medium">Documentation</h4>
                      {selectedProvider === "openai" && (
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get OpenAI API Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {selectedProvider === "anthropic" && (
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get Anthropic API Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {selectedProvider === "google" && (
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get Google AI API Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {selectedProvider === "xai" && (
                        <a
                          href="https://console.x.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get xAI API Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {selectedProvider === "gateway" && (
                        <a
                          href="https://vercel.com/docs/ai-gateway"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get Vercel AI Gateway Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {selectedProvider === "openrouter" && (
                        <a
                          href="https://openrouter.ai/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          Get OpenRouter API Key
                          <IconExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    Select a provider to configure
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
