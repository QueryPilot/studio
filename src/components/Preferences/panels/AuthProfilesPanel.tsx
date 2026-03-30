import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTunnelStore } from "@/stores/tunnelStore";
import type { AuthProfile, AuthProvider } from "@/types/tunnel";
import { getProviderType } from "@/types/tunnel";
import {
  IconPencil,
  IconTrash,
  IconPlus,
  IconArrowLeft,
} from "@tabler/icons-react";

type ProviderKey =
  | "AzureAdSaml"
  | "StaticAwsCredentials"
  | "EnvironmentAwsCredentials";

const PROVIDER_OPTIONS: { value: ProviderKey; label: string; desc: string }[] =
  [
    {
      value: "AzureAdSaml",
      label: "Azure AD SAML",
      desc: "Authenticate via Azure AD with SAML 2.0",
    },
    {
      value: "StaticAwsCredentials",
      label: "Static AWS Credentials",
      desc: "Use a fixed access key and secret",
    },
    {
      value: "EnvironmentAwsCredentials",
      label: "Environment Variables",
      desc: "Read AWS credentials from shell environment",
    },
  ];

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  AzureAdSaml: "Azure AD SAML",
  StaticAwsCredentials: "Static AWS Credentials",
  EnvironmentAwsCredentials: "Environment Variables",
};

function defaultProvider(type: ProviderKey): AuthProvider {
  switch (type) {
    case "AzureAdSaml":
      return {
        AzureAdSaml: {
          tenant_id: "",
          app_id_uri: "",
          default_username: "",
          session_duration_hours: 1,
          default_role_arn: "",
        },
      };
    case "StaticAwsCredentials":
      return {
        StaticAwsCredentials: {
          access_key_id: "",
          secret_access_key: "",
          region: "",
        },
      };
    case "EnvironmentAwsCredentials":
      return { EnvironmentAwsCredentials: { region: "" } };
  }
}

interface FormState {
  name: string;
  providerType: ProviderKey;
  provider: AuthProvider;
}

function extractFormState(profile: AuthProfile): FormState {
  return {
    name: profile.name,
    providerType: getProviderType(profile.provider),
    provider: structuredClone(profile.provider),
  };
}

function newFormState(): FormState {
  return {
    name: "",
    providerType: "AzureAdSaml",
    provider: defaultProvider("AzureAdSaml"),
  };
}

// ---------- Provider sub-forms ----------

function AzureAdSamlFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { AzureAdSaml: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const d = provider.AzureAdSaml;
  const set = (patch: Partial<typeof d>) => {
    onChange({ AzureAdSaml: { ...d, ...patch } });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">
            Tenant ID <span className="text-destructive">*</span>
          </Label>
          <Input
            value={d.tenant_id}
            onChange={(e) => {
              set({ tenant_id: e.target.value });
            }}
            className="mt-1 h-8 text-xs font-mono"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <div>
          <Label className="text-xs">
            App ID URI <span className="text-destructive">*</span>
          </Label>
          <Input
            value={d.app_id_uri}
            onChange={(e) => {
              set({ app_id_uri: e.target.value });
            }}
            className="mt-1 h-8 text-xs"
            placeholder="https://signin.aws.amazon.com/saml"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Default Username</Label>
          <Input
            value={d.default_username ?? ""}
            onChange={(e) => {
              set({ default_username: e.target.value || undefined });
            }}
            className="mt-1 h-8 text-xs"
            placeholder="user@example.com"
          />
        </div>
        <div>
          <Label className="text-xs">Default Role ARN</Label>
          <Input
            value={d.default_role_arn ?? ""}
            onChange={(e) => {
              set({ default_role_arn: e.target.value || undefined });
            }}
            className="mt-1 h-8 text-xs font-mono"
            placeholder="arn:aws:iam::123456789012:role/Role"
          />
        </div>
      </div>
      <div className="w-32">
        <Label className="text-xs">
          Session (hours) <span className="text-destructive">*</span>
        </Label>
        <Input
          type="number"
          min={1}
          max={12}
          value={d.session_duration_hours}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) set({ session_duration_hours: v });
          }}
          className="mt-1 h-8 text-xs w-20"
        />
      </div>
    </div>
  );
}

function StaticAwsFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { StaticAwsCredentials: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const d = provider.StaticAwsCredentials;
  const set = (patch: Partial<typeof d>) => {
    onChange({ StaticAwsCredentials: { ...d, ...patch } });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">
            Access Key ID <span className="text-destructive">*</span>
          </Label>
          <Input
            value={d.access_key_id}
            onChange={(e) => {
              set({ access_key_id: e.target.value });
            }}
            className="mt-1 h-8 text-xs font-mono"
            placeholder="AKIAIOSFODNN7EXAMPLE"
          />
        </div>
        <div>
          <Label className="text-xs">
            Region <span className="text-destructive">*</span>
          </Label>
          <Input
            value={d.region}
            onChange={(e) => {
              set({ region: e.target.value });
            }}
            className="mt-1 h-8 text-xs"
            placeholder="ap-southeast-2"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">
          Secret Access Key <span className="text-destructive">*</span>
        </Label>
        <Input
          type="password"
          value={d.secret_access_key}
          onChange={(e) => {
            set({ secret_access_key: e.target.value });
          }}
          className="mt-1 h-8 text-xs"
        />
      </div>
    </div>
  );
}

function EnvAwsFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { EnvironmentAwsCredentials: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const d = provider.EnvironmentAwsCredentials;
  return (
    <div className="space-y-3">
      <div className="w-48">
        <Label className="text-xs">Region Override</Label>
        <Input
          value={d.region ?? ""}
          onChange={(e) => {
            onChange({
              EnvironmentAwsCredentials: {
                region: e.target.value || undefined,
              },
            });
          }}
          className="mt-1 h-8 text-xs"
          placeholder="ap-southeast-2"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Reads AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN
        from the shell environment at app launch.
      </p>
    </div>
  );
}

// ---------- Main panel ----------

export function AuthProfilesPanel() {
  const authProfiles = useTunnelStore((s) => s.authProfiles);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(newFormState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void useTunnelStore.getState().fetchProfiles();
  }, []);

  const startEdit = useCallback((profile: AuthProfile) => {
    setEditing(profile.id);
    setForm(extractFormState(profile));
  }, []);

  const startNew = useCallback(() => {
    setEditing("new");
    setForm(newFormState());
  }, []);

  const cancel = useCallback(() => {
    setEditing(null);
  }, []);

  const handleProviderTypeChange = useCallback((type: ProviderKey) => {
    setForm((prev) => ({
      ...prev,
      providerType: type,
      provider: defaultProvider(type),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (editing === null) return;
    const id = editing === "new" ? crypto.randomUUID() : editing;
    const profile: AuthProfile = {
      id,
      name: form.name.trim(),
      provider: form.provider,
      created_at:
        editing === "new"
          ? new Date().toISOString()
          : (authProfiles.find((p) => p.id === id)?.created_at ??
            new Date().toISOString()),
    };
    setSaving(true);
    try {
      await useTunnelStore.getState().saveAuthProfile(profile);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, form, authProfiles]);

  const handleDelete = useCallback(async (id: string) => {
    await useTunnelStore.getState().deleteAuthProfile(id);
  }, []);

  const isFormValid = (): boolean => {
    if (!form.name.trim()) return false;
    const pt = form.providerType;
    if (pt === "AzureAdSaml" && "AzureAdSaml" in form.provider) {
      const d = form.provider.AzureAdSaml;
      return !!(d.tenant_id && d.app_id_uri && d.session_duration_hours > 0);
    }
    if (
      pt === "StaticAwsCredentials" &&
      "StaticAwsCredentials" in form.provider
    ) {
      const d = form.provider.StaticAwsCredentials;
      return !!(d.access_key_id && d.secret_access_key && d.region);
    }
    return true;
  };

  // ---------- Edit / New ----------
  if (editing !== null) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10">
          <button
            onClick={cancel}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </button>
          <h2 className="text-base font-semibold">
            {editing === "new" ? "New Auth Profile" : "Edit Auth Profile"}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4 space-y-5">
          {/* Name */}
          <div>
            <Label className="text-xs">
              Profile Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
              className="mt-1 h-8 text-xs"
              placeholder="e.g., Azure AD - UAT"
              autoFocus
            />
          </div>

          {/* Provider Type as RadioGroup */}
          <div>
            <Label className="text-xs">
              Provider Type <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={form.providerType}
              onValueChange={(v) => {
                handleProviderTypeChange(v as ProviderKey);
              }}
              className="mt-2 space-y-1.5"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  htmlFor={`provider-${opt.value}`}
                  className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                >
                  <RadioGroupItem
                    id={`provider-${opt.value}`}
                    value={opt.value}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-medium">{opt.label}</span>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      {opt.desc}
                    </p>
                  </div>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Provider-specific fields */}
          <div className="border-t pt-4">
            {form.providerType === "AzureAdSaml" &&
              "AzureAdSaml" in form.provider && (
                <AzureAdSamlFields
                  provider={form.provider}
                  onChange={(p) => {
                    setForm((f) => ({ ...f, provider: p }));
                  }}
                />
              )}
            {form.providerType === "StaticAwsCredentials" &&
              "StaticAwsCredentials" in form.provider && (
                <StaticAwsFields
                  provider={form.provider}
                  onChange={(p) => {
                    setForm((f) => ({ ...f, provider: p }));
                  }}
                />
              )}
            {form.providerType === "EnvironmentAwsCredentials" &&
              "EnvironmentAwsCredentials" in form.provider && (
                <EnvAwsFields
                  provider={form.provider}
                  onChange={(p) => {
                    setForm((f) => ({ ...f, provider: p }));
                  }}
                />
              )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !isFormValid()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- List ----------
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Auth Profiles</h2>
          <p className="text-xs text-muted-foreground">
            Manage authentication profiles for tunnel connections
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          <IconPlus className="h-3.5 w-3.5 mr-1.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4">
        {authProfiles.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No auth profiles yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {authProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between py-3 border rounded-xl px-4"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-medium truncate">{profile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {PROVIDER_LABELS[getProviderType(profile.provider)]}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      startEdit(profile);
                    }}
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(profile.id)}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
