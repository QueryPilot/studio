import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconArrowLeft,
  IconChevronDown,
  IconFolderOpen,
  IconAlertCircle,
  IconSettings,
  IconFile,
  IconDatabase,
  IconCalendar,
  IconTable,
} from "@tabler/icons-react";

import { type ConnectionProfile } from "@/types/connection";

// ============ Types ============

interface RestoreConfigStepProps {
  profile: ConnectionProfile;
  initialConfig?: {
    sourcePath?: string;
    options?: Record<string, unknown>;
  };
  onConfigChange?: (partial: {
    sourcePath?: string;
    options?: Record<string, unknown>;
  }) => void;
  onStart: (config: RestoreConfig) => void;
  onBack: () => void;
}

export interface RestoreConfig {
  sourcePath: string;
  options: Record<string, unknown>;
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
  supportedFormats: Array<{
    id: string;
    name: string;
    extension: string;
    description: string;
  }>;
  backupOptions: BackupOptionsSchema;
  restoreOptions: BackupOptionsSchema;
}

interface BackupPreviewObject {
  name: string;
  object_type: string;
  row_count: number | null;
}

interface BackupPreview {
  file_name: string;
  file_size: number;
  database_type: string;
  created_at: string | null;
  objects: BackupPreviewObject[];
}

// ============ Utilities ============

/**
 * Format file size in human-readable form (KB, MB, GB)
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ============ Component ============

export const RestoreConfigStep = ({
  profile,
  initialConfig,
  onConfigChange,
  onStart,
  onBack,
}: RestoreConfigStepProps) => {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Capability info from backend
  const [capability, setCapability] = useState<BackupCapabilityInfo | null>(
    null,
  );

  // Form state - use initial values if provided
  const [sourcePath, setSourcePath] = useState(initialConfig?.sourcePath ?? "");
  const [options, setOptions] = useState<Record<string, unknown>>(initialConfig?.options ?? {});

  // Notify parent of config changes for persistence
  useEffect(() => {
    onConfigChange?.({
      sourcePath,
      options,
    });
  }, [sourcePath, options, onConfigChange]);

  // Preview state
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // UI state
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Fetch restore capability on mount
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

        // Initialize options with defaults from restoreOptions
        const defaultOptions: Record<string, unknown> = {};
        for (const field of info.restoreOptions.common) {
          defaultOptions[field.key] = field.default;
        }
        for (const field of info.restoreOptions.advanced) {
          defaultOptions[field.key] = field.default;
        }
        setOptions(defaultOptions);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          "backup-restore",
          "Failed to fetch restore capability:",
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
  }, [profile]);

  // Fetch backup preview when source path changes
  useEffect(() => {
    if (!sourcePath) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let mounted = true;

    async function fetchPreview() {
      try {
        setPreviewLoading(true);
        setPreviewError(null);

        const previewData = await invoke<BackupPreview>("get_backup_preview", {
          profile,
          filePath: sourcePath,
        });

        if (!mounted) return;

        setPreview(previewData);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("backup-restore", "Failed to fetch backup preview:", err);
        setPreviewError(message);
        setPreview(null);
      } finally {
        if (mounted) {
          setPreviewLoading(false);
        }
      }
    }

    void fetchPreview();

    return () => {
      mounted = false;
    };
  }, [profile, sourcePath]);

  // Handle file path browse
  const handleBrowse = async () => {
    try {
      const filePath = await open({
        title: "Select Backup File",
        multiple: false,
        filters: [
          { name: "SQLite Files", extensions: ["db", "sqlite", "sql"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (filePath && typeof filePath === "string") {
        setSourcePath(filePath);
      }
    } catch (err) {
      logger.error("backup-restore", "Failed to open file dialog:", err);
    }
  };

  // Handle option change
  const handleOptionChange = (key: string, value: unknown) => {
    setOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Handle start restore
  const handleStart = () => {
    if (!sourcePath) return;

    // Include connection parameters from profile in options
    const configOptions = {
      ...options,
      host: profile.host,
      port: profile.port,
      user: profile.username,
      password: profile.password,
      database: profile.database,
    };

    const config: RestoreConfig = {
      sourcePath: sourcePath,
      options: configOptions,
    };

    onStart(config);
  };

  // Check if form is valid
  const isValid = sourcePath.trim() !== "" && preview !== null && !previewError;

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
          <h2 className="text-xl font-semibold">Configure Restore</h2>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-32 w-full" />
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
          <h2 className="text-xl font-semibold">Configure Restore</h2>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive select-text">
          <IconAlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load restore options</p>
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
        <h2 className="text-xl font-semibold">Configure Restore</h2>
      </div>

      <p className="text-muted-foreground">
        Select a backup file and configure restore options.
      </p>

      {/* Source Path */}
      <div className="space-y-2">
        <Label htmlFor="source">Backup File</Label>
        <div className="flex gap-2">
          <Input
            id="source"
            value={sourcePath}
            onChange={(e) => {
              setSourcePath(e.target.value);
            }}
            placeholder="Select a backup file to restore..."
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
      </div>

      {/* Backup Preview */}
      {sourcePath && (
        <div className="space-y-2">
          <Label>Backup Preview</Label>
          {previewLoading ? (
            <Card>
              <CardContent className="py-4">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ) : previewError ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
              <IconAlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Failed to read backup file</p>
                <p className="text-sm opacity-80">{previewError}</p>
              </div>
            </div>
          ) : preview ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Backup Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* File Info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <IconFile className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">File:</span>
                    <span
                      className="font-medium truncate"
                      title={preview.file_name}
                    >
                      {preview.file_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <IconDatabase className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Size:</span>
                    <span className="font-medium">
                      {formatFileSize(preview.file_size)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <IconDatabase className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium">{preview.database_type}</span>
                  </div>
                  {preview.created_at && (
                    <div className="flex items-center gap-2">
                      <IconCalendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Created:</span>
                      <span className="font-medium">{preview.created_at}</span>
                    </div>
                  )}
                </div>

                {/* Objects List */}
                {preview.objects.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <IconTable className="h-4 w-4" />
                      Objects in Backup ({preview.objects.length})
                    </div>
                    <div className="border rounded-md divide-y max-h-48 overflow-auto">
                      {preview.objects.map((obj, index) => (
                        <div
                          key={`${obj.name}-${index}`}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs uppercase">
                              {obj.object_type}
                            </span>
                            <span className="font-medium">{obj.name}</span>
                          </div>
                          {obj.row_count !== null && (
                            <span className="text-muted-foreground text-xs">
                              {obj.row_count.toLocaleString()} rows
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* Common Options */}
      {capability && capability.restoreOptions.common.length > 0 && (
        <div className="space-y-4">
          <Label>Options</Label>
          <div className="space-y-3">
            {capability.restoreOptions.common.map((field) => (
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
      {capability && capability.restoreOptions.advanced.length > 0 && (
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
              {capability.restoreOptions.advanced.map((field) => (
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
          {!sourcePath
            ? "Select backup file to continue"
            : previewLoading
              ? "Loading preview..."
              : previewError
                ? "Invalid backup file"
                : "Start Restore"}
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
