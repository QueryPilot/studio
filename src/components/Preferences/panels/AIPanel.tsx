import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconCircleCheckFilled,
  IconCircleX,
  IconRefresh,
  IconSearch,
  IconX,
  IconExternalLink,
  IconKey,
  IconRobot,
  IconSparkles,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  getChatProviders,
  getSidecarStatus,
  searchOpenRouterModels,
  type AIProviderConfig,
  type OpenRouterModel,
} from "@/services/aiService";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export default function AIPanel() {
  // Provider state
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loadingProviders, setLoadingProviders] = useState(true);

  // API Key state
  const [currentApiKey, setCurrentApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sidecar status
  const [sidecarStatus, setSidecarStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

  // OpenRouter model search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OpenRouterModel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedModel, setSelectedModel] = useState<OpenRouterModel | null>(
    null,
  );

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
      console.error("Failed to load providers:", error);
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
      console.error("Failed to load API key:", error);
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
      console.error("Failed to check sidecar status:", error);
      setSidecarStatus("offline");
    }
  }, []);

  // Search OpenRouter models
  const handleModelSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchOpenRouterModels(searchQuery, 20, 0);
      setSearchResults(result?.models || []);
    } catch (error) {
      console.error("Failed to search models:", error);
      toast.error("Failed to search models");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

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
        console.log("✅ API keys reloaded in sidecar");
      } catch (reloadError) {
        console.error("Failed to reload API keys in sidecar:", reloadError);
      }

      // Refresh configured providers
      const statusData = await getSidecarStatus();
      setConfiguredProviders(statusData?.configuredProviders || []);

      toast.success(`${selectedProvider} API key saved securely`);
    } catch (error) {
      console.error("Failed to save API key:", error);
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
    }
  }, [selectedProvider, loadApiKey]);

  // Search on Enter key
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchQuery) {
        void handleModelSearch();
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [searchQuery, handleModelSearch]);

  const currentProviderConfig = providers.find((p) => p.name === selectedProvider);
  const isProviderConfigured = configuredProviders.includes(selectedProvider);

  return (
    <div className="max-w-5xl space-y-6 max-h-[calc(80vh-2rem)] overflow-y-auto -mx-4 px-4">
      {/* Header */}
      <div className="sticky top-0 bg-background z-10 pb-4 border-b">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <IconRobot className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">AI Assistant Configuration</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Configure AI providers and manage API keys securely
            </p>
          </div>

          {/* Sidecar Status */}
          <div className="flex items-center gap-2">
            {sidecarStatus === "checking" && (
              <Badge variant="secondary" className="gap-1.5">
                <IconLoader2 className="h-3 w-3 animate-spin" />
                Checking...
              </Badge>
            )}
            {sidecarStatus === "online" && (
              <Badge variant="default" className="gap-1.5 bg-green-600">
                <IconCircleCheckFilled className="h-3 w-3" />
                AI Sidecar Online
              </Badge>
            )}
            {sidecarStatus === "offline" && (
              <Badge variant="destructive" className="gap-1.5">
                <IconCircleX className="h-3 w-3" />
                AI Sidecar Offline
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void checkSidecarStatus();
                void loadProviders();
              }}
              disabled={sidecarStatus === "checking"}
            >
              <IconRefresh className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {loadingProviders ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IconLoader2 className="h-5 w-5 animate-spin" />
            <span>Loading providers...</span>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="configure" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="configure">
              <IconKey className="h-4 w-4 mr-2" />
              Configure Providers
            </TabsTrigger>
            <TabsTrigger value="browse">
              <IconSparkles className="h-4 w-4 mr-2" />
              Browse Models
            </TabsTrigger>
          </TabsList>

          {/* Configure Tab */}
          <TabsContent value="configure" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Provider List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Available Providers</CardTitle>
                  <CardDescription>
                    Select a provider to configure
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-2">
                      {providers.map((provider) => {
                        const isConfigured = configuredProviders.includes(
                          provider.name,
                        );
                        const isSelected = selectedProvider === provider.name;

                        return (
                          <button
                            key={provider.name}
                            onClick={() => setSelectedProvider(provider.name)}
                            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50 hover:bg-accent"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="space-y-1 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium capitalize">
                                    {provider.name}
                                  </span>
                                  {isConfigured && (
                                    <IconCircleCheckFilled className="h-4 w-4 text-green-600" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {provider.models.length} models available
                                </p>
                              </div>
                              {provider.requiresApiKey && (
                                <Badge
                                  variant={
                                    isConfigured ? "default" : "secondary"
                                  }
                                  className="text-xs"
                                >
                                  {isConfigured ? "Configured" : "API Key Required"}
                                </Badge>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Configuration Panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base capitalize">
                    {selectedProvider || "Select Provider"}
                  </CardTitle>
                  <CardDescription>
                    {currentProviderConfig?.requiresApiKey
                      ? "Configure API key for this provider"
                      : "No API key required"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentProviderConfig ? (
                    <>
                      {/* Models List */}
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">
                          Available Models
                        </Label>
                        <ScrollArea className="h-32 rounded-md border p-3">
                          <div className="space-y-1">
                            {currentProviderConfig.models.map((model) => (
                              <div
                                key={model}
                                className="text-xs font-mono text-muted-foreground"
                              >
                                • {model}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>

                      <Separator />

                      {/* API Key Configuration */}
                      {currentProviderConfig.requiresApiKey && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="api-key">API Key</Label>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <Input
                                  id="api-key"
                                  type={showApiKey ? "text" : "password"}
                                  value={currentApiKey}
                                  onChange={(e) =>
                                    setCurrentApiKey(e.target.value)
                                  }
                                  placeholder={`Enter ${selectedProvider} API key`}
                                  className="pr-10 font-mono text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowApiKey(!showApiKey)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {showApiKey ? (
                                    <IconEyeOff className="h-4 w-4" />
                                  ) : (
                                    <IconEye className="h-4 w-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Stored securely in system keychain
                            </p>
                          </div>

                          <Button
                            onClick={handleSaveApiKey}
                            disabled={isSaving || !currentApiKey.trim()}
                            className="w-full"
                          >
                            {isSaving && (
                              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Save API Key
                          </Button>

                          {isProviderConfigured && (
                            <div className="flex items-center gap-2 text-xs text-green-600">
                              <IconCircleCheckFilled className="h-4 w-4" />
                              <span>Provider configured successfully</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Provider Links */}
                      <div className="pt-4 space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">
                          Documentation
                        </Label>
                        {selectedProvider === "openai" && (
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                            className="flex items-center gap-2 text-xs text-primary hover:underline"
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
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Browse Models Tab */}
          <TabsContent value="browse" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Browse OpenRouter Models
                </CardTitle>
                <CardDescription>
                  Search and explore 200+ AI models from OpenRouter
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search Bar */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search models (e.g., claude, gpt, llama)..."
                      className="pl-10 pr-10"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <IconX className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    onClick={handleModelSearch}
                    disabled={isSearching || !searchQuery.trim()}
                  >
                    {isSearching ? (
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <IconSearch className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Results */}
                {searchResults.length > 0 ? (
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-3">
                      {searchResults.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => setSelectedModel(model)}
                          className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                            selectedModel?.id === model.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50 hover:bg-accent"
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                  {model.name}
                                </div>
                                <div className="text-xs font-mono text-muted-foreground">
                                  {model.id}
                                </div>
                              </div>
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {model.contextLength.toLocaleString()} ctx
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {model.description}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>
                                In: ${model.pricing.prompt.toFixed(6)}/1k
                              </span>
                              <span>
                                Out: ${model.pricing.completion.toFixed(6)}/1k
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {model.modality}
                              </Badge>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : searchQuery && !isSearching ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No models found for "{searchQuery}"
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    Enter a search query to browse models
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
