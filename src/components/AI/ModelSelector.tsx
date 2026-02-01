/**
 * Model Selector Component
 *
 * Searchable combobox for selecting AI models.
 * Shows models available for the currently selected agent.
 * Supports dynamic model fetching and custom model input.
 */

import { useState, useMemo } from "react";
import { useAcpStore, useAvailableModels, useIsLoadingModels } from "@/stores/acpStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  IconChevronDown,
  IconCheck,
  IconBrain,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function ModelSelector() {
  const { selectedModel, selectModel } = useAcpStore();
  const models = useAvailableModels();
  const isLoadingModels = useIsLoadingModels();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const currentModel = models.find((m) => m.id === selectedModel);
  // Check if current model is a custom one (not in the list)
  const isCustomModel = selectedModel && !currentModel;

  // Filter models based on search
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const searchLower = search.toLowerCase();
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(searchLower) ||
        m.name.toLowerCase().includes(searchLower) ||
        m.description.toLowerCase().includes(searchLower)
    );
  }, [models, search]);

  // Check if search matches any model exactly
  const hasExactMatch = useMemo(() => {
    if (!search.trim()) return true;
    const searchLower = search.toLowerCase();
    return models.some(
      (m) =>
        m.id.toLowerCase() === searchLower ||
        m.name.toLowerCase() === searchLower
    );
  }, [models, search]);

  const handleSelect = (modelId: string) => {
    void selectModel(modelId);
    setOpen(false);
    setSearch("");
  };

  const handleUseCustom = () => {
    if (search.trim()) {
      void selectModel(search.trim());
      setOpen(false);
      setSearch("");
    }
  };

  // Don't show if no models available and not loading
  if (models.length === 0 && !isLoadingModels) {
    return null;
  }

  // Display name for trigger button
  const displayName = isLoadingModels
    ? "Loading..."
    : currentModel?.name ?? (isCustomModel ? selectedModel : "Select model");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center h-6 gap-1 px-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md text-[11px] font-medium"
      >
        {isLoadingModels ? (
          <IconLoader2 className="h-3 w-3 animate-spin" />
        ) : (
          <IconBrain className="h-3 w-3" />
        )}
        <span className="truncate max-w-[120px]">
          {displayName}
        </span>
        <IconChevronDown className="h-3 w-3 opacity-50 shrink-0" />
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/* Show "use as custom" when search doesn't match */}
            {search.trim() && !hasExactMatch && (
              <CommandGroup>
                <CommandItem
                  value={`custom:${search}`}
                  onSelect={handleUseCustom}
                  className="gap-2"
                >
                  <IconPlus className="h-3.5 w-3.5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium">
                      Use "{search}"
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Custom model ID
                    </div>
                  </div>
                </CommandItem>
              </CommandGroup>
            )}

            {/* Model list */}
            {filteredModels.length > 0 ? (
              <CommandGroup heading={isLoadingModels ? "Loading..." : "Models"}>
                {filteredModels.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => { handleSelect(model.id); }}
                    className="gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">
                        {model.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {model.description}
                      </div>
                    </div>
                    <IconCheck
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        model.id === selectedModel ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>
                {search.trim() ? (
                  <div className="space-y-1">
                    <p>No models found</p>
                    <p className="text-[10px] text-muted-foreground">
                      Press Enter to use "{search}" as custom model
                    </p>
                  </div>
                ) : (
                  "No models available"
                )}
              </CommandEmpty>
            )}

            {/* Show current custom model if selected */}
            {isCustomModel && !search.trim() && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={selectedModel}
                  onSelect={() => { handleSelect(selectedModel); }}
                  className="gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">
                      {selectedModel}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Custom model
                    </div>
                  </div>
                  <IconCheck className="h-3.5 w-3.5 shrink-0" />
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
