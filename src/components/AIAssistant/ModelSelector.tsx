import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAIStore, type AIProviderConfig } from "@/stores/aiStore";
import { Badge } from "@/components/ui/badge";

interface ModelSelectorProps {
  onModelChange?: (provider: string, model: string) => void;
}

export function ModelSelector({ onModelChange }: ModelSelectorProps) {
  const {
    selectedProvider,
    activeModel,
    setActiveModel,
    defaultModels,
    providers: cachedProviders,
    setProviders,
    configuredProviders,
  } = useAIStore();

  const [providers, setLocalProviders] =
    useState<AIProviderConfig[]>(cachedProviders);

  // Load providers from backend
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const fetchedProviders: AIProviderConfig[] = await invoke(
          "get_ai_providers",
        );
        setLocalProviders(fetchedProviders);
        setProviders(fetchedProviders);
      } catch (error) {
        console.error("Failed to load providers:", error);
      }
    };

    if (cachedProviders.length === 0) {
      void loadProviders();
    }
  }, [cachedProviders.length, setProviders]);

  // Get only configured providers (those with API keys or Ollama)
  const availableProviders = providers.filter(
    (p) => !p.requiresApiKey || configuredProviders.includes(p.name),
  );

  // Add Ollama if not already configured
  const ollamaProvider = providers.find((p) => p.name === "ollama");
  if (ollamaProvider && !availableProviders.some((p) => p.name === "ollama")) {
    availableProviders.push(ollamaProvider);
  }

  const currentModel =
    activeModel || defaultModels[selectedProvider] || "No model selected";

  // Find which provider has the current model
  const currentProviderForModel = availableProviders.find((p) =>
    p.models.includes(currentModel),
  );

  const handleModelSelect = (provider: string, model: string) => {
    setActiveModel(model);
    onModelChange?.(provider, model);
  };

  // Group models by provider
  const modelGroups = availableProviders.map((provider) => ({
    provider: provider.name,
    models: provider.models,
    isDefault: provider.name === selectedProvider,
  }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-2 px-2 text-xs font-normal"
        >
          <span className="text-muted-foreground">Model:</span>
          <span className="font-medium">{currentModel || "Select model"}</span>
          {currentProviderForModel && (
            <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">
              {currentProviderForModel.name}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {modelGroups.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No configured providers. Please add an API key in Settings.
          </div>
        ) : (
          modelGroups.map((group, index) => (
            <div key={group.provider}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                <span className="capitalize">{group.provider}</span>
                {group.isDefault && (
                  <Badge variant="outline" className="h-4 text-[9px] px-1">
                    Default
                  </Badge>
                )}
              </DropdownMenuLabel>
              {group.models.map((model) => (
                <DropdownMenuItem
                  key={model}
                  onClick={() => { handleModelSelect(group.provider, model); }}
                  className="text-xs"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono">{model}</span>
                    {currentModel === model && (
                      <Badge variant="default" className="h-4 text-[9px] px-1">
                        Active
                      </Badge>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
