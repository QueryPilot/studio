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
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AI_SIDECAR_URL } from "@/config/constants";

const AI_PROVIDERS = [
  { name: "openai", label: "OpenAI", requiresApiKey: true },
  { name: "anthropic", label: "Anthropic", requiresApiKey: true },
  { name: "google", label: "Google", requiresApiKey: true },
  { name: "ollama", label: "Ollama", requiresApiKey: false },
];

export default function AIPanel() {
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [currentApiKey, setCurrentApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [sidecarStatus, setSidecarStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

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
      const url = AI_SIDECAR_URL;

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
    void checkSidecarStatus();
  }, [checkSidecarStatus]);

  useEffect(() => {
    if (selectedProvider) {
      void loadApiKey();
    }
  }, [selectedProvider, loadApiKey]);

  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);
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

      try {
        await invoke("reload_ai_api_keys");
        console.log("✅ API keys reloaded in sidecar");
      } catch (reloadError) {
        console.error("Failed to reload API keys in sidecar:", reloadError);
      }

      toast.success("API Key saved securely.");
    } catch (error) {
      console.error("Failed to save API key:", error);
      toast.error("Failed to save API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentProviderConfig = AI_PROVIDERS.find(
    (p) => p.name === selectedProvider,
  );

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(80vh-2rem)] overflow-y-scroll -mx-4 px-4">
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">AI Assistant Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure API keys for AI providers. Sidecar infrastructure is ready
          for future features.
        </p>
      </div>

      {/* Sidecar Status */}
      <div className="rounded-xl border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">AI Assistant Status</h3>

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
              {AI_PROVIDERS.map((provider) => (
                <SelectItem key={provider.name} value={provider.name}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose which AI provider to configure
          </p>
        </div>

        {currentProviderConfig && currentProviderConfig.requiresApiKey && (
          <div className="space-y-2">
            <Label htmlFor="api-key">
              {currentProviderConfig.label} API Key
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={currentApiKey}
                  onChange={handleApiKeyChange}
                  placeholder={`Enter your ${currentProviderConfig.label} API Key`}
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
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your API key is stored securely using the system keychain
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
