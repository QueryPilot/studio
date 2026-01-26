import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  IconArrowLeft,
  IconChevronDown,
  IconFolderOpen,
  IconAlertCircle,
  IconLoader2,
  IconSettings,
} from "@tabler/icons-react";

import { type ConnectionProfile } from "@/types/connection";

// ============ Types ============

interface BackupConfigStepProps {
  profile: ConnectionProfile;
  onStart: (config: BackupConfig) => void;
  onBack: () => void;
}

export interface BackupConfig {
  destination_path: string;
  format: string;
  selected_objects: string[] | null;
  options: Record<string, unknown>;
}

interface BackupFormat {
  id: string;
  name: string;
  extension: string;
  description: string;
}

interface FieldType {
  type: "bool" | "string" | "number" | "select";
  min?: number;
  max?: number;
  options?: SelectOption[];
}

interface SelectOption {
  value: string;
  label: string;
}

interface OptionField {
  key: string;
  label: string;
  fieldType: FieldType;
  default: unknown;
  description: string;
}

interface BackupOptionsSchema {
  common: OptionField[];
  advanced: OptionField[];
}

interface BackupCapabilityInfo {
  toolRequirements: Array<{
    name: string;
    purpose: string;
    downloadSizeMb: number;
  }>;
  supportedFormats: BackupFormat[];
  backupOptions: BackupOptionsSchema;
  restoreOptions: BackupOptionsSchema;
}

// ============ Component ============

export const BackupConfigStep = ({
  profile,
  onStart,
  onBack,
}: BackupConfigStepProps) => {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Capability info from backend
  const [capability, setCapability] = useState<BackupCapabilityInfo | null>(
    null,
  );

  // Form state
  const [destinationPath, setDestinationPath] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [options, setOptions] = useState<Record<string, unknown>>({});

  // UI state
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Fetch backup capability on mount
  useEffect(() => {
    let mounted = true;

    async function fetchCapability() {
      try {
        setLoading(true);
        setError(null);

        const info = await invoke<BackupCapabilityInfo>(
          "get_backup_capability",
          {
            profile,
          },
        );

        if (!mounted) return;

        setCapability(info);

        // Set default format
        if (info.supportedFormats.length > 0 && !selectedFormat) {
          const defaultFormat = info.supportedFormats[0];
          if (defaultFormat) {
            setSelectedFormat(defaultFormat.id);
          }
        }

        // Initialize options with defaults
        const defaultOptions: Record<string, unknown> = {};
        for (const field of info.backupOptions.common) {
          defaultOptions[field.key] = field.default;
        }
        for (const field of info.backupOptions.advanced) {
          defaultOptions[field.key] = field.default;
        }
        setOptions(defaultOptions);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          "backup-restore",
          "Failed to fetch backup capability:",
          err,
        );
        setError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void fetchCapability();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedFormat only used for conditional check, not as trigger
  }, [profile]);

  // Get current format object
  const currentFormat = useMemo(() => {
    if (!capability) return null;
    return (
      capability.supportedFormats.find((f) => f.id === selectedFormat) ?? null
    );
  }, [capability, selectedFormat]);

  // Handle file path browse
  const handleBrowse = async () => {
    if (!currentFormat) return;

    try {
      const filePath = await save({
        title: "Save Backup",
        filters: [
          {
            name: currentFormat.name,
            extensions: [currentFormat.extension.replace(".", "")],
          },
        ],
        defaultPath: `backup${currentFormat.extension}`,
      });

      if (filePath) {
        setDestinationPath(filePath);
      }
    } catch (err) {
      logger.error("backup-restore", "Failed to open save dialog:", err);
    }
  };

  // Handle format change - update file extension
  const handleFormatChange = (formatId: string) => {
    setSelectedFormat(formatId);

    // Update file extension if path exists
    if (destinationPath) {
      const newFormat = capability?.supportedFormats.find(
        (f) => f.id === formatId,
      );
      if (newFormat) {
        // Replace extension in path
        const pathWithoutExt = destinationPath.replace(/\.[^/.]+$/, "");
        setDestinationPath(`${pathWithoutExt}${newFormat.extension}`);
      }
    }
  };

  // Handle option change
  const handleOptionChange = (key: string, value: unknown) => {
    setOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Handle start backup
  const handleStart = () => {
    if (!destinationPath || !selectedFormat) return;

    const config: BackupConfig = {
      destination_path: destinationPath,
      format: selectedFormat,
      selected_objects: null, // Full backup for now
      options,
    };

    onStart(config);
  };

  // Check if form is valid
  const isValid = destinationPath.trim() !== "" && selectedFormat !== "";

  // ============ Render Loading ============
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">Configure Backup</h2>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // ============ Render Error ============
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">Configure Backup</h2>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive select-text">
          <IconAlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load backup options</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        </div>

        <Button variant="outline" onClick={onBack}>
          Go Back
        </Button>
      </div>
    );
  }

  // ============ Render Form ============
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Go back to operation selection"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">Configure Backup</h2>
      </div>

      <p className="text-muted-foreground">
        Set up your backup options and choose where to save the backup file.
      </p>

      {/* Destination Path */}
      <div className="space-y-2">
        <Label htmlFor="destination">Destination</Label>
        <div className="flex gap-2">
          <Input
            id="destination"
            value={destinationPath}
            onChange={(e) => {
              setDestinationPath(e.target.value);
            }}
            placeholder="Choose where to save the backup..."
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => void handleBrowse()}
            title="Browse"
          >
            <IconFolderOpen className="h-4 w-4" />
          </Button>
        </div>
        {currentFormat && (
          <p className="text-xs text-muted-foreground">
            File will be saved with {currentFormat.extension} extension
          </p>
        )}
      </div>

      {/* Format Selection */}
      {capability && capability.supportedFormats.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <Select
            value={selectedFormat}
            onValueChange={(value) => {
              if (value) handleFormatChange(value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {currentFormat?.name ?? "Select backup format"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {capability.supportedFormats.map((format) => (
                <SelectItem key={format.id} value={format.id}>
                  <div className="flex flex-col gap-0.5">
                    <span>{format.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {format.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Common Options */}
      {capability && capability.backupOptions.common.length > 0 && (
        <div className="space-y-4">
          <Label>Options</Label>
          <div className="space-y-3">
            {capability.backupOptions.common.map((field) => (
              <OptionFieldRenderer
                key={field.key}
                field={field}
                value={options[field.key]}
                onChange={(value) => {
                  handleOptionChange(field.key, value);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Advanced Options */}
      {capability && capability.backupOptions.advanced.length > 0 && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              "hover:text-foreground transition-colors",
              advancedOpen ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <IconSettings className="h-4 w-4" />
            Advanced Options
            <IconChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                advancedOpen && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="space-y-3 pl-6 border-l-2 border-border">
              {capability.backupOptions.advanced.map((field) => (
                <OptionFieldRenderer
                  key={field.key}
                  field={field}
                  value={options[field.key]}
                  onChange={(value) => {
                    handleOptionChange(field.key, value);
                  }}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleStart} disabled={!isValid}>
          {!isValid ? (
            "Select destination to continue"
          ) : (
            <>
              <IconLoader2 className="h-4 w-4 mr-1.5 hidden group-data-[loading]:block group-data-[loading]:animate-spin" />
              Start Backup
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

// ============ Option Field Renderer ============

interface OptionFieldRendererProps {
  field: OptionField;
  value: unknown;
  onChange: (value: unknown) => void;
}

const OptionFieldRenderer = ({
  field,
  value,
  onChange,
}: OptionFieldRendererProps) => {
  const { fieldType } = field;

  // Bool field -> Switch
  if (fieldType.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={field.key} className="text-sm font-medium">
            {field.label}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
        <Switch
          id={field.key}
          checked={Boolean(value)}
          onCheckedChange={onChange}
        />
      </div>
    );
  }

  // String field -> Input
  if (fieldType.type === "string") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={field.key}>{field.label}</Label>
        <Input
          id={field.key}
          value={String(value ?? "")}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={field.description}
        />
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  // Number field -> Input with type number
  if (fieldType.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={field.key}>{field.label}</Label>
        <Input
          id={field.key}
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => {
            // Handle empty input by falling back to default
            if (e.target.value === "") {
              onChange(field.default);
              return;
            }
            const num = parseFloat(e.target.value);
            if (!isNaN(num)) {
              // Clamp to min/max if defined
              let clamped = num;
              if (fieldType.min !== undefined && clamped < fieldType.min) {
                clamped = fieldType.min;
              }
              if (fieldType.max !== undefined && clamped > fieldType.max) {
                clamped = fieldType.max;
              }
              onChange(clamped);
            }
          }}
          min={fieldType.min}
          max={fieldType.max}
          placeholder={field.description}
        />
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  // Select field -> Select dropdown
  if (fieldType.type === "select" && fieldType.options) {
    const currentOption = fieldType.options.find(
      (opt) => opt.value === String(value ?? ""),
    );
    return (
      <div className="space-y-1.5">
        <Label htmlFor={field.key}>{field.label}</Label>
        <Select
          value={String(value ?? "")}
          onValueChange={(newValue) => {
            if (newValue) onChange(newValue);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {currentOption?.label ?? `Select ${field.label.toLowerCase()}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {fieldType.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  // Fallback for unknown field type
  return (
    <div className="space-y-1.5">
      <Label>{field.label}</Label>
      <p className="text-xs text-muted-foreground">
        Unsupported field type: {fieldType.type}
      </p>
    </div>
  );
};
