// src/components/AI/ProviderSettings.tsx
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLoader2,
} from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import type { ProviderId } from "@/ai/types";

export function ProviderSettings() {
  const { providerId, modelId, setProvider, setModel, initSession, session } =
    useByokStore();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null,
  );

  const config = providerId ? PROVIDER_CONFIGS[providerId] : null;

  const handleTestConnection = useCallback(() => {
    if (!providerId || !modelId) return;
    if (config?.requiresApiKey && !apiKey) return;

    setTesting(true);
    setTestResult(null);

    try {
      initSession(apiKey || undefined);
      setTestResult("success");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  }, [providerId, modelId, apiKey, config, initSession]);

  return (
    <div className="space-y-3 px-3 py-2">
      {/* Provider Selector */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">Provider</Label>
        <Select
          value={providerId ?? ""}
          onValueChange={(v) => {
            if (v != null) {
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
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
              placeholder={`Enter ${config.name} API key...`}
              className="h-8 text-xs font-mono"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => {
                setShowKey(!showKey);
              }}
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

      {/* Model Selector */}
      {config && (
        <div className="space-y-1">
          <Label className="text-xs font-medium">Model</Label>
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

      {/* Test / Connect Button */}
      {config && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={handleTestConnection}
          disabled={testing || (config.requiresApiKey && !apiKey)}
        >
          {testing ? (
            <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : testResult === "success" ? (
            <IconCheck className="h-3.5 w-3.5 mr-1.5 text-green-500" />
          ) : null}
          {session ? "Connected" : "Connect"}
        </Button>
      )}

      {/* No API key note for Ollama */}
      {config && !config.requiresApiKey && (
        <p className="text-[11px] text-muted-foreground">
          No API key needed — runs locally on your machine.
        </p>
      )}
    </div>
  );
}
