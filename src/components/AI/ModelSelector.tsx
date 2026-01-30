/**
 * Model Selector Component
 *
 * Compact dropdown for selecting AI models.
 * Shows models available for the currently selected agent.
 * Supports dynamic model fetching and custom model input.
 */

import { useState } from "react";
import { useAcpStore, useAvailableModels, useIsLoadingModels } from "@/stores/acpStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  IconChevronDown,
  IconCheck,
  IconBrain,
  IconLoader2,
  IconPencil,
} from "@tabler/icons-react";

export function ModelSelector() {
  const { selectedModel, selectModel } = useAcpStore();
  const models = useAvailableModels();
  const isLoadingModels = useIsLoadingModels();

  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customModelId, setCustomModelId] = useState("");

  const currentModel = models.find((m) => m.id === selectedModel);
  // Check if current model is a custom one (not in the list)
  const isCustomModel = selectedModel && !currentModel;

  const handleSelect = (modelId: string) => {
    void selectModel(modelId);
    setShowCustomInput(false);
  };

  const handleCustomSubmit = () => {
    if (customModelId.trim()) {
      void selectModel(customModelId.trim());
      setShowCustomInput(false);
      setCustomModelId("");
    }
  };

  // Don't show if no models available and not loading
  if (models.length === 0 && !isLoadingModels) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button
            {...props}
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-muted-foreground hover:text-foreground"
          >
            {isLoadingModels ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <IconBrain className="h-3 w-3" />
            )}
            <span className="text-[11px] font-medium truncate max-w-[120px]">
              {isLoadingModels
                ? "Loading..."
                : currentModel?.name ?? (isCustomModel ? selectedModel : "Select model")}
            </span>
            <IconChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        )}
      />

      <DropdownMenuContent align="end" className="w-64">
        {/* Custom Model Input */}
        {showCustomInput ? (
          <div className="p-2 space-y-2">
            <div className="text-[10px] text-muted-foreground font-medium">
              Custom Model ID
            </div>
            <div className="flex gap-1">
              <Input
                value={customModelId}
                onChange={(e) => { setCustomModelId(e.target.value); }}
                placeholder="provider/model-id"
                className="h-7 text-[12px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit();
                  if (e.key === "Escape") setShowCustomInput(false);
                }}
                autoFocus
              />
              <Button
                size="sm"
                className="h-7 px-2"
                onClick={handleCustomSubmit}
                disabled={!customModelId.trim()}
              >
                Set
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Format: provider/model (e.g., openai/gpt-5.2)
            </div>
          </div>
        ) : (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                {isLoadingModels ? "Loading models..." : "Model"}
              </DropdownMenuLabel>
              {models.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => { handleSelect(model.id); }}
                  className="gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{model.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {model.description}
                    </div>
                  </div>
                  {model.id === selectedModel && (
                    <IconCheck className="h-3 w-3 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Custom Model Option */}
            <DropdownMenuItem
              onClick={() => { setShowCustomInput(true); }}
              className="gap-2 text-muted-foreground"
            >
              <IconPencil className="h-3 w-3" />
              <span className="text-[12px]">Custom model...</span>
              {isCustomModel && (
                <IconCheck className="h-3 w-3 text-primary ml-auto" />
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
