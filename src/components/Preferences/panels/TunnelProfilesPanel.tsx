import { useCallback, useEffect, useState } from "react";
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
import type { TunnelProfile, TunnelType } from "@/types/tunnel";
import { getTunnelTypeKey } from "@/types/tunnel";
import type { SshAuthMethod } from "@/types/connection";
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconNetwork,
} from "@tabler/icons-react";

type TunnelTypeKey = "SshTunnel" | "SsmBastion";

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

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void useTunnelStore.getState().fetchProfiles();
  }, []);

  const handleNew = useCallback(() => {
    setForm({ ...EMPTY_FORM });
    setEditing(true);
  }, []);

  const handleEdit = useCallback((profile: TunnelProfile) => {
    setForm(formFromProfile(profile));
    setEditing(true);
  }, []);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setForm(EMPTY_FORM);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await useTunnelStore.getState().deleteTunnelProfile(id);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await useTunnelStore.getState().saveTunnelProfile(formToProfile(form));
      setEditing(false);
      setForm(EMPTY_FORM);
    } finally {
      setSaving(false);
    }
  }, [form]);

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---- Render ----

  if (editing) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10">
          <h2 className="text-base font-semibold">
            {form.id ? "Edit Tunnel Profile" : "New Tunnel Profile"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Configure a reusable tunnel for database connections.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Profile Name</Label>
            <Input
              value={form.name}
              onChange={(e) => { updateForm({ name: e.target.value }); }}
              placeholder="e.g. Production SSH Bastion"
              className="h-8 text-xs"
            />
          </div>

          {/* Tunnel Type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Tunnel Type</Label>
            <Select
              value={form.tunnelTypeKey}
              onValueChange={(v) => {
                if (v) updateForm({ tunnelTypeKey: v as TunnelTypeKey });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SshTunnel" className="text-xs">
                  SSH Tunnel
                </SelectItem>
                <SelectItem value="SsmBastion" className="text-xs">
                  SSM Bastion
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SSH Fields */}
          {form.tunnelTypeKey === "SshTunnel" && (
            <div className="space-y-3 border rounded-lg p-4">
              <p className="text-xs font-medium text-muted-foreground">
                SSH Connection
              </p>
              <div className="grid grid-cols-[1fr_80px] gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Host</Label>
                  <Input
                    value={form.sshHost}
                    onChange={(e) => { updateForm({ sshHost: e.target.value }); }}
                    placeholder="bastion.example.com"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Port</Label>
                  <Input
                    type="number"
                    value={form.sshPort}
                    onChange={(e) => {
                      updateForm({ sshPort: parseInt(e.target.value, 10) || 22 });
                    }}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">User</Label>
                <Input
                  value={form.sshUser}
                  onChange={(e) => { updateForm({ sshUser: e.target.value }); }}
                  placeholder="ec2-user"
                  className="h-8 text-xs"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Authentication defaults to SSH Agent.
              </p>
            </div>
          )}

          {/* SSM Fields */}
          {form.tunnelTypeKey === "SsmBastion" && (
            <div className="space-y-3 border rounded-lg p-4">
              <p className="text-xs font-medium text-muted-foreground">
                SSM Bastion
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Region</Label>
                <Input
                  value={form.ssmRegion}
                  onChange={(e) => { updateForm({ ssmRegion: e.target.value }); }}
                  placeholder="us-east-1"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Cluster Name{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  value={form.ssmClusterName}
                  onChange={(e) => {
                    updateForm({ ssmClusterName: e.target.value });
                  }}
                  placeholder="my-ecs-cluster"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Task Definition{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  value={form.ssmTaskDefinition}
                  onChange={(e) => {
                    updateForm({ ssmTaskDefinition: e.target.value });
                  }}
                  placeholder="bastion-task"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          {/* Auth Profile */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Auth Profile{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={form.authProfileId || "__none__"}
              onValueChange={(v) => {
                updateForm({ authProfileId: !v || v === "__none__" ? "" : v });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
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
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- List View ----

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Tunnel Profiles</h2>
          <p className="text-xs text-muted-foreground">
            Reusable SSH and SSM tunnel configurations for database connections.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={handleNew}>
          <IconPlus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-4 space-y-2">
        {tunnelProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <IconNetwork className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              No tunnel profiles yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create one to reuse across connections.
            </p>
          </div>
        ) : (
          tunnelProfiles.map((profile) => {
            const typeKey = getTunnelTypeKey(profile.tunnel_type);
            const typeLabel =
              typeKey === "SshTunnel" ? "SSH Tunnel" : "SSM Bastion";
            return (
              <div
                key={profile.id}
                className="flex items-center justify-between border rounded-lg px-4 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{profile.name}</p>
                  <p className="text-xs text-muted-foreground">{typeLabel}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => { handleEdit(profile); }}
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(profile.id)}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default TunnelProfilesPanel;
