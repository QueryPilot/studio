import { useCallback, useEffect, useState } from "react";
import { useAIStore } from "@/stores/aiStore";
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
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AI_SIDECAR_URL } from "@/config/constants";

interface AIProviderConfig {
  name: string;
  models: string[];
  requiresApiKey: boolean;
}

export default function AIPanel() {
  const {
    selectedProvider,
    setSelectedProvider,
    defaultModels,
    setDefaultModel,
    addConfiguredProvider,
  } = useAIStore();
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [currentApiKey, setCurrentApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidecarUrl, setSidecarUrl] = useState<string | null>(null);
  const [sidecarStatus, setSidecarStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

  const loadProviders = useCallback(async () => {
    try {
      const fetchedProviders: AIProviderConfig[] = await invoke(
        "get_ai_providers",
      );
      setProviders(fetchedProviders);
      // Set default provider if none selected or current is invalid
      if (
        !selectedProvider ||
        !fetchedProviders.some((p) => p.name === selectedProvider)
      ) {
        setSelectedProvider(fetchedProviders[0]?.name || "");
      }
    } catch (error) {
      console.error("Failed to load AI providers:", error);
      toast.error("Failed to load AI providers.");
    }
  }, [selectedProvider, setSelectedProvider]);

  const loadApiKey = useCallback(async () => {
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

  const checkSidecarStatus = useCallback(async () => {
    setSidecarStatus("checking");
    try {
      // Use hardcoded sidecar URL
      const url = AI_SIDECAR_URL;
      setSidecarUrl(url);

      // Try to fetch health endpoint
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        setSidecarStatus("online");
      } else {
        setSidecarStatus("offline");
      }
    } catch (error) {
      console.error("Failed to check sidecar status:", error);
      setSidecarStatus("offline");
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void checkSidecarStatus();
  }, [loadProviders, checkSidecarStatus]);

  useEffect(() => {
    if (selectedProvider) {
      void loadApiKey();
    }
  }, [selectedProvider, loadApiKey]);

  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);
  };

  const handleModelChange = (value: string) => {
    // Set default model for the selected provider
    setDefaultModel(selectedProvider, value);
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentApiKey(e.target.value);
  };

  const handleSaveApiKey = async () => {
    setIsSaving(true);
    try {
      await invoke("set_ai_api_key", {
        provider: selectedProvider,
        apiKey: currentApiKey,
      });

      // Mark this provider as configured
      if (currentApiKey.trim()) {
        addConfiguredProvider(selectedProvider);
      }

      // Reload API keys in the sidecar
      try {
        await invoke("reload_ai_api_keys");
        console.log("✅ API keys reloaded in sidecar");

        // Reload configured providers list
        const providers: string[] = await invoke("get_configured_providers");
        useAIStore.getState().setConfiguredProviders(providers);
        console.log("✅ Updated configured providers:", providers);
      } catch (reloadError) {
        console.error("Failed to reload API keys in sidecar:", reloadError);
        // Don't fail the save, just log it
      }

      toast.success("API Key saved securely.");
    } catch (error) {
      console.error("Failed to save API key:", error);
      toast.error("Failed to save API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentProviderConfig = providers.find(
    (p) => p.name === selectedProvider,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">AI Assistant Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your preferred AI provider and model for the assistant.
        </p>
      </div>

      {/* Sidecar Status */}
      <div className="rounded-xl border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">AI Sidecar Status</h3>
            <p className="text-xs text-muted-foreground">
              {sidecarUrl || "Not running"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sidecarStatus === "checking" && (
              <Badge variant="secondary" className="gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking...
              </Badge>
            )}
            {sidecarStatus === "online" && (
              <Badge variant="default" className="gap-1.5 bg-green-600">
                <CheckCircle2 className="h-3 w-3" />
                Online
              </Badge>
            )}
            {sidecarStatus === "offline" && (
              <Badge variant="destructive" className="gap-1.5">
                <XCircle className="h-3 w-3" />
                Offline
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={checkSidecarStatus}
              disabled={sidecarStatus === "checking"}
            >
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6">
        {/* AI Provider Selection */}
        <div className="space-y-2">
          <Label htmlFor="ai-provider">AI Provider</Label>
          <Select value={selectedProvider} onValueChange={handleProviderChange}>
            <SelectTrigger id="ai-provider">
              <SelectValue placeholder="Select an AI provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.name} value={provider.name}>
                  {provider.name.charAt(0).toUpperCase() +
                    provider.name.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose which AI provider to use for the assistant
          </p>
        </div>

        {currentProviderConfig && (
          <>
            {/* Default Model Selection */}
            <div className="space-y-2">
              <Label htmlFor="ai-model">Default Model</Label>
              <Select
                value={defaultModels[selectedProvider] || ""}
                onValueChange={handleModelChange}
              >
                <SelectTrigger id="ai-model">
                  <SelectValue placeholder="Select a default model" />
                </SelectTrigger>
                <SelectContent>
                  {currentProviderConfig.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This model will be used by default. You can change it per
                conversation in the chat.
              </p>
            </div>

            {/* API Key Input */}
            {currentProviderConfig.requiresApiKey && (
              <div className="space-y-2">
                <Label htmlFor="api-key">
                  {currentProviderConfig.name.charAt(0).toUpperCase() +
                    currentProviderConfig.name.slice(1)}{" "}
                  API Key
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="api-key"
                      type={showApiKey ? "text" : "password"}
                      value={currentApiKey}
                      onChange={handleApiKeyChange}
                      placeholder={`Enter your ${currentProviderConfig.name} API Key`}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowApiKey(!showApiKey);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    onClick={handleSaveApiKey}
                    disabled={isSaving || !currentApiKey.trim()}
                  >
                    {isSaving && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your API key is stored securely using the system keychain
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
