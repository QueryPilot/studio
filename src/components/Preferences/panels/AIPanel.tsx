import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  ExternalLink,
  Key,
  LogIn,
} from "lucide-react";

export default function AIPanel() {
  const {
    selectedRuntime,
    setSelectedRuntime,
    aiProviders,
    saveProviderApiKey,
    clearProviderAuth,
    setUnsavedChanges,
  } = usePreferencesStore();

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  useEffect(() => {
    setUnsavedChanges(false);
  }, []);

  const handleRuntimeChange = (value: string) => {
    setSelectedRuntime(value as "opencode" | "openai-codex");
    setUnsavedChanges(true);
  };

  const handleApiKeyChange = (providerId: string, value: string) => {
    setApiKeys({ ...apiKeys, [providerId]: value });
    setUnsavedChanges(true);
  };

  const toggleShowApiKey = (providerId: string) => {
    setShowApiKeys({ ...showApiKeys, [providerId]: !showApiKeys[providerId] });
  };

  const handleSaveApiKey = async (providerId: string) => {
    const apiKey = apiKeys[providerId];
    if (!apiKey) return;

    setTestingProvider(providerId);
    // Simulate API test
    await new Promise((resolve) => setTimeout(resolve, 1000));

    saveProviderApiKey(selectedRuntime, providerId, apiKey);
    setApiKeys({ ...apiKeys, [providerId]: "" });
    setTestingProvider(null);
    setUnsavedChanges(true);
  };

  const handleClearAuth = (providerId: string) => {
    clearProviderAuth(selectedRuntime, providerId);
    setApiKeys({ ...apiKeys, [providerId]: "" });
    setUnsavedChanges(true);
  };

  const handleOAuthConnect = (providerId: string) => {
    // OAuth flow would be implemented here
    console.log(`Initiating OAuth for ${providerId}`);
  };

  const providers = aiProviders[selectedRuntime] || [];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">AI Runtime Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure AI runtime providers and authentication
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label>Runtime</Label>
          <Select value={selectedRuntime} onValueChange={handleRuntimeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opencode">OpenCode</SelectItem>
              <SelectItem value="openai-codex">OpenAI Codex CLI</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-base mb-3 block">Provider Configuration</Label>
            <div className="text-sm text-muted-foreground mb-4">
              Configure authentication for AI providers
            </div>
          </div>
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {provider.authType === "api-key" ? (
                      <Badge variant="outline">
                        <Key className="h-3 w-3 mr-1" />
                        API Key
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <LogIn className="h-3 w-3 mr-1" />
                        OAuth
                      </Badge>
                    )}
                    {provider.configured && (
                      <Badge variant="default" className="bg-green-600">
                        <Check className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {provider.authType === "api-key" ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showApiKeys[provider.id] ? "text" : "password"}
                          placeholder={
                            provider.configured ? "••••••••" : "Enter API key"
                          }
                          value={apiKeys[provider.id] || ""}
                          onChange={(e) => {
                            handleApiKeyChange(provider.id, e.target.value);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            toggleShowApiKey(provider.id);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showApiKeys[provider.id] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {testingProvider === provider.id ? (
                        <Button disabled>
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </Button>
                      ) : provider.configured ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            handleClearAuth(provider.id);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSaveApiKey(provider.id)}
                          disabled={!apiKeys[provider.id]}
                        >
                          Save
                        </Button>
                      )}
                    </div>
                    {provider.configured && provider.config?.apiKey && (
                      <p className="text-xs text-muted-foreground">
                        Key ending in ...{provider.config.apiKey.slice(-4)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {provider.configured ? (
                      <div className="flex items-center justify-between">
                        <div className="text-sm">
                          <p>
                            Connected as:{" "}
                            {provider.config?.accountInfo?.email || "Unknown"}
                          </p>
                          {provider.config?.expiresAt && (
                            <p className="text-xs text-muted-foreground">
                              Expires:{" "}
                              {new Date(
                                provider.config.expiresAt,
                              ).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            handleClearAuth(provider.id);
                          }}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={() => {
                          handleOAuthConnect(provider.id);
                        }}
                        className="w-full"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Connect with {provider.name}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
