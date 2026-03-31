import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTunnelStore } from "@/stores/tunnelStore";
import type { TunnelProfile, TunnelType } from "@/types/tunnel";
import { getTunnelTypeKey } from "@/types/tunnel";
import type { SshAuthMethod } from "@/types/connection";
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconArrowLeft,
} from "@tabler/icons-react";

type TunnelTypeKey = "SshTunnel" | "SsmBastion";

const TUNNEL_TYPE_OPTIONS: {
  value: TunnelTypeKey;
  label: string;
  desc: string;
}[] = [
  {
    value: "SshTunnel",
    label: "SSH Tunnel",
    desc: "Connect through an SSH bastion host",
  },
  {
    value: "SsmBastion",
    label: "SSM Bastion",
    desc: "Connect via AWS Systems Manager Session Manager",
  },
];

const TUNNEL_TYPE_LABELS: Record<TunnelTypeKey, string> = {
  SshTunnel: "SSH Tunnel",
  SsmBastion: "SSM Bastion",
};

interface FormState {
  id: string;
  name: string;
  tunnelTypeKey: TunnelTypeKey;
  authProfileId: string;
  // SSH fields
  sshHost: string;
  sshPort: number;
  sshUser: string;
  // SSM fields
  ssmRegion: string;
  ssmClusterName: string;
  ssmTaskDefinition: string;
}

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  tunnelTypeKey: "SshTunnel",
  authProfileId: "",
  sshHost: "",
  sshPort: 22,
  sshUser: "",
  ssmRegion: "",
  ssmClusterName: "",
  ssmTaskDefinition: "",
};

function formFromProfile(p: TunnelProfile): FormState {
  const key = getTunnelTypeKey(p.tunnel_type);
  const base: FormState = {
    ...EMPTY_FORM,
    id: p.id,
    name: p.name,
    tunnelTypeKey: key,
    authProfileId: p.auth_profile_id ?? "",
  };
  if ("SshTunnel" in p.tunnel_type) {
    const ssh = p.tunnel_type.SshTunnel;
    base.sshHost = ssh.host;
    base.sshPort = ssh.port;
    base.sshUser = ssh.user;
  } else if ("SsmBastion" in p.tunnel_type) {
    const ssm = p.tunnel_type.SsmBastion;
    base.ssmRegion = ssm.region;
    base.ssmClusterName = ssm.cluster_name ?? "";
    base.ssmTaskDefinition = ssm.task_definition ?? "";
  }
  return base;
}

function formToProfile(f: FormState): TunnelProfile {
  let tunnel_type: TunnelType;
  if (f.tunnelTypeKey === "SshTunnel") {
    const auth: SshAuthMethod = { Agent: true };
    tunnel_type = {
      SshTunnel: {
        host: f.sshHost,
        port: f.sshPort,
        user: f.sshUser,
        auth,
      },
    };
  } else {
    tunnel_type = {
      SsmBastion: {
        region: f.ssmRegion,
        cluster_name: f.ssmClusterName || undefined,
        task_definition: f.ssmTaskDefinition || undefined,
      },
    };
  }
  return {
    id: f.id || crypto.randomUUID(),
    name: f.name,
    tunnel_type,
    auth_profile_id: f.authProfileId || undefined,
    created_at: new Date().toISOString(),
  };
}

export function TunnelProfilesPanel() {
  const tunnelProfiles = useTunnelStore((s) => s.tunnelProfiles);
  const authProfiles = useTunnelStore((s) => s.authProfiles);

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void useTunnelStore.getState().fetchProfiles();
  }, []);

  const startNew = useCallback(() => {
    setEditing("new");
    setForm({ ...EMPTY_FORM });
  }, []);

  const startEdit = useCallback((profile: TunnelProfile) => {
    setEditing(profile.id);
    setForm(formFromProfile(profile));
  }, []);

  const cancel = useCallback(() => {
    setEditing(null);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await useTunnelStore.getState().deleteTunnelProfile(id);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const profile = formToProfile(form);
      if (editing !== "new" && editing !== null) {
        profile.id = editing;
        const existing = useTunnelStore
          .getState()
          .tunnelProfiles.find((p) => p.id === editing);
        if (existing) {
          profile.created_at = existing.created_at;
        }
      }
      await useTunnelStore.getState().saveTunnelProfile(profile);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, form]);

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTunnelTypeChange = useCallback((type: TunnelTypeKey) => {
    setForm((prev) => ({
      ...prev,
      tunnelTypeKey: type,
    }));
  }, []);

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
            {editing === "new" ? "New Tunnel Profile" : "Edit Tunnel Profile"}
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
                updateForm({ name: e.target.value });
              }}
              className="mt-1 h-8 text-xs"
              placeholder="e.g., Production SSH Bastion"
              autoFocus
            />
          </div>

          {/* Tunnel Type as RadioGroup */}
          <div>
            <Label className="text-xs">
              Tunnel Type <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={form.tunnelTypeKey}
              onValueChange={(v) => {
                handleTunnelTypeChange(v as TunnelTypeKey);
              }}
              className="mt-2 space-y-1.5"
            >
              {TUNNEL_TYPE_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  htmlFor={`tunnel-${opt.value}`}
                  className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                >
                  <RadioGroupItem
                    id={`tunnel-${opt.value}`}
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

          {/* Type-specific fields */}
          <div className="border-t pt-4">
            {/* SSH Fields */}
            {form.tunnelTypeKey === "SshTunnel" && (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_80px] gap-3">
                  <div>
                    <Label className="text-xs">
                      Host <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={form.sshHost}
                      onChange={(e) => {
                        updateForm({ sshHost: e.target.value });
                      }}
                      className="mt-1 h-8 text-xs"
                      placeholder="bastion.example.com"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Port</Label>
                    <Input
                      type="number"
                      value={form.sshPort}
                      onChange={(e) => {
                        updateForm({
                          sshPort: parseInt(e.target.value, 10) || 22,
                        });
                      }}
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">
                    User <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.sshUser}
                    onChange={(e) => {
                      updateForm({ sshUser: e.target.value });
                    }}
                    className="mt-1 h-8 text-xs"
                    placeholder="ec2-user"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Authentication defaults to SSH Agent.
                </p>
              </div>
            )}

            {/* SSM Fields */}
            {form.tunnelTypeKey === "SsmBastion" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">
                    Region <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.ssmRegion}
                    onChange={(e) => {
                      updateForm({ ssmRegion: e.target.value });
                    }}
                    className="mt-1 h-8 text-xs"
                    placeholder="us-east-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">
                    Cluster Name{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={form.ssmClusterName}
                    onChange={(e) => {
                      updateForm({ ssmClusterName: e.target.value });
                    }}
                    className="mt-1 h-8 text-xs"
                    placeholder="my-ecs-cluster"
                  />
                </div>
                <div>
                  <Label className="text-xs">
                    Task Definition{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={form.ssmTaskDefinition}
                    onChange={(e) => {
                      updateForm({ ssmTaskDefinition: e.target.value });
                    }}
                    className="mt-1 h-8 text-xs"
                    placeholder="bastion-task"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Auth Profile */}
          <div>
            <Label className="text-xs">
              Auth Profile{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={form.authProfileId || "__none__"}
              onValueChange={(v) => {
                updateForm({ authProfileId: !v || v === "__none__" ? "" : v });
              }}
            >
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">
                  None
                </SelectItem>
                {authProfiles.map((ap) => (
                  <SelectItem key={ap.id} value={ap.id} className="text-xs">
                    {ap.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim()}
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
          <h2 className="text-base font-semibold">
            Tunnel Profiles
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              BETA
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Reusable SSH and SSM tunnel configurations for database connections.
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          <IconPlus className="h-3.5 w-3.5 mr-1.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4">
        {tunnelProfiles.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No tunnel profiles yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {tunnelProfiles.map((profile) => {
              const typeKey = getTunnelTypeKey(profile.tunnel_type);
              return (
                <div
                  key={profile.id}
                  className="flex items-center justify-between py-3 border rounded-xl px-4"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {profile.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {TUNNEL_TYPE_LABELS[typeKey]}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default TunnelProfilesPanel;
