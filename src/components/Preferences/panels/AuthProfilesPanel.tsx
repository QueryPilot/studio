import { useEffect, useState, useCallback } from "react";
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

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  AzureAdSaml: "Azure AD SAML",
  StaticAwsCredentials: "Static AWS Credentials",
  EnvironmentAwsCredentials: "Environment AWS Credentials",
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
      return {
        EnvironmentAwsCredentials: {
          region: "",
        },
      };
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

// ---------- Sub-forms per provider ----------

function AzureAdSamlFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { AzureAdSaml: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const data = provider.AzureAdSaml;
  const set = (patch: Partial<typeof data>) => {
    onChange({ AzureAdSaml: { ...data, ...patch } });
  };

  return (
    <>
      <FieldRow label="Tenant ID" required>
        <Input
          value={data.tenant_id}
          onChange={(e) => {
            set({ tenant_id: e.target.value });
          }}
          className="h-8 text-xs"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </FieldRow>
      <FieldRow label="App ID URI" required>
        <Input
          value={data.app_id_uri}
          onChange={(e) => {
            set({ app_id_uri: e.target.value });
          }}
          className="h-8 text-xs"
          placeholder="https://myapp.example.com"
        />
      </FieldRow>
      <FieldRow label="Default Username">
        <Input
          value={data.default_username ?? ""}
          onChange={(e) => {
            set({ default_username: e.target.value || undefined });
          }}
          className="h-8 text-xs"
          placeholder="user@example.com"
        />
      </FieldRow>
      <FieldRow label="Session Duration (hours)" required>
        <Input
          type="number"
          min={1}
          max={12}
          value={data.session_duration_hours}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) set({ session_duration_hours: v });
          }}
          className="h-8 text-xs w-24"
        />
      </FieldRow>
      <FieldRow label="Default Role ARN">
        <Input
          value={data.default_role_arn ?? ""}
          onChange={(e) => {
            set({ default_role_arn: e.target.value || undefined });
          }}
          className="h-8 text-xs"
          placeholder="arn:aws:iam::123456789012:role/MyRole"
        />
      </FieldRow>
    </>
  );
}

function StaticAwsFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { StaticAwsCredentials: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const data = provider.StaticAwsCredentials;
  const set = (patch: Partial<typeof data>) => {
    onChange({ StaticAwsCredentials: { ...data, ...patch } });
  };

  return (
    <>
      <FieldRow label="Access Key ID" required>
        <Input
          value={data.access_key_id}
          onChange={(e) => {
            set({ access_key_id: e.target.value });
          }}
          className="h-8 text-xs"
          placeholder="AKIAIOSFODNN7EXAMPLE"
        />
      </FieldRow>
      <FieldRow label="Secret Access Key" required>
        <Input
          type="password"
          value={data.secret_access_key}
          onChange={(e) => {
            set({ secret_access_key: e.target.value });
          }}
          className="h-8 text-xs"
        />
      </FieldRow>
      <FieldRow label="Region" required>
        <Input
          value={data.region}
          onChange={(e) => {
            set({ region: e.target.value });
          }}
          className="h-8 text-xs"
          placeholder="us-east-1"
        />
      </FieldRow>
    </>
  );
}

function EnvAwsFields({
  provider,
  onChange,
}: {
  provider: Extract<AuthProvider, { EnvironmentAwsCredentials: unknown }>;
  onChange: (p: AuthProvider) => void;
}) {
  const data = provider.EnvironmentAwsCredentials;

  return (
    <FieldRow label="Region (optional)">
      <Input
        value={data.region ?? ""}
        onChange={(e) => {
          onChange({
            EnvironmentAwsCredentials: {
              region: e.target.value || undefined,
            },
          });
        }}
        className="h-8 text-xs"
        placeholder="us-east-1"
      />
    </FieldRow>
  );
}

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

// ---------- Main panel ----------

export function AuthProfilesPanel() {
  const { authProfiles, fetchProfiles, saveAuthProfile, deleteAuthProfile } =
    useTunnelStore();

  const [editing, setEditing] = useState<string | null>(null); // profile id or "new"
  const [form, setForm] = useState<FormState>(newFormState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

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
      await saveAuthProfile(profile);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, form, authProfiles, saveAuthProfile]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteAuthProfile(id);
    },
    [deleteAuthProfile],
  );

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
    // EnvironmentAwsCredentials has no required fields beyond name
    return true;
  };

  // ---------- Edit / New view ----------
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
          <p className="text-xs text-muted-foreground">
            Configure authentication credentials for tunnel connections
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4 space-y-4">
          <FieldRow label="Profile Name" required>
            <Input
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
              className="h-8 text-xs"
              placeholder="My Auth Profile"
              autoFocus
            />
          </FieldRow>

          <FieldRow label="Provider Type" required>
            <Select
              value={form.providerType}
              onValueChange={(v) => {
                handleProviderTypeChange(v as ProviderKey);
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_LABELS) as ProviderKey[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {PROVIDER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          <div className="border-t pt-4 space-y-4">
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

          <div className="flex items-center gap-2 pt-4 border-t">
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

  // ---------- List view ----------
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
                  <p className="text-xs text-muted-foreground">
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
