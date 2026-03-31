import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconNetwork, IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTunnelStore } from "@/stores/tunnelStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

export type TunnelMode = "none" | "ssh" | "ssm" | "profile";

interface TunnelSectionProps {
  tunnelMode: TunnelMode;
  onTunnelModeChange: (mode: TunnelMode) => void;
  ssmAuthProfileId: string;
  onSsmAuthProfileIdChange: (id: string) => void;
  ssmRegion: string;
  onSsmRegionChange: (region: string) => void;
  remoteHost: string;
  onRemoteHostChange: (host: string) => void;
  remotePort: string;
  onRemotePortChange: (port: string) => void;
  tunnelProfileId: string;
  onTunnelProfileIdChange: (id: string) => void;
  saveAsProfile: boolean;
  onSaveAsProfileChange: (save: boolean) => void;
  disabled?: boolean;
}

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ca-central-1",
  "sa-east-1",
];

const modeOptions: { value: TunnelMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "ssh", label: "SSH" },
  { value: "ssm", label: "SSM Bastion" },
  { value: "profile", label: "Saved Profile" },
];

export function TunnelSection({
  tunnelMode,
  onTunnelModeChange,
  ssmAuthProfileId,
  onSsmAuthProfileIdChange,
  ssmRegion,
  onSsmRegionChange,
  remoteHost,
  onRemoteHostChange,
  remotePort,
  onRemotePortChange,
  tunnelProfileId,
  onTunnelProfileIdChange,
  saveAsProfile,
  onSaveAsProfileChange,
  disabled,
}: TunnelSectionProps) {
  const authProfiles = useTunnelStore((s) => s.authProfiles);
  const tunnelProfiles = useTunnelStore((s) => s.tunnelProfiles);

  useEffect(() => {
    void useTunnelStore.getState().fetchProfiles();
  }, []);

  const openAuthSettings = () => {
    usePreferencesStore.getState().openPreferences("auth-profiles" as never);
  };

  const openTunnelSettings = () => {
    usePreferencesStore.getState().openPreferences("tunnel-profiles" as never);
  };

  return (
    <div>
      {/* Header — matches SSL Mode / Safe Mode pattern */}
      <Label className="flex items-center gap-1.5 text-xs">
        <IconNetwork className="h-3 w-3 text-muted-foreground" />
        Tunnel
      </Label>

      {/* Mode selector — matches SSL Mode radio row */}
      <RadioGroup
        value={tunnelMode}
        onValueChange={(value) => {
          onTunnelModeChange(value as TunnelMode);
        }}
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
      >
        {modeOptions.map((option) => {
          const id = `tunnel-mode-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                tunnelMode === option.value && "text-primary",
              )}
            >
              <RadioGroupItem id={id} value={option.value} />
              {option.label}
            </Label>
          );
        })}
      </RadioGroup>

      {/* SSM Bastion inline config */}
      {tunnelMode === "ssm" && (
        <div className="mt-3 space-y-3">
          {/* Auth Profile + Region row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ssm-auth-profile" className="text-xs">
                Auth Profile
              </Label>
              {authProfiles.length > 0 ? (
                <Select
                  value={ssmAuthProfileId}
                  onValueChange={(v) => {
                    if (v) onSsmAuthProfileIdChange(v);
                  }}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue placeholder="Select auth profile...">
                      {authProfiles.find((p) => p.id === ssmAuthProfileId)
                        ?.name ?? "Select auth profile..."}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {authProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1 h-8 w-full justify-start gap-1.5 text-xs text-muted-foreground"
                  onClick={openAuthSettings}
                >
                  <IconPlus className="h-3 w-3" />
                  Create auth profile...
                </Button>
              )}
            </div>
            <div>
              <Label htmlFor="ssm-region" className="text-xs">
                Region
              </Label>
              <Select
                value={ssmRegion}
                onValueChange={(v) => {
                  if (v) onSsmRegionChange(v);
                }}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AWS_REGIONS.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Remote Host + Port row */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-8">
              <Label htmlFor="tunnel-remote-host" className="text-xs">
                Remote Host
              </Label>
              <Input
                id="tunnel-remote-host"
                className="mt-1 h-8 text-xs"
                value={remoteHost}
                onChange={(e) => onRemoteHostChange(e.target.value)}
                placeholder="cluster.xxx.rds.amazonaws.com"
                disabled={disabled}
              />
            </div>
            <div className="col-span-4">
              <Label htmlFor="tunnel-remote-port" className="text-xs">
                Remote Port
              </Label>
              <Input
                id="tunnel-remote-port"
                className="mt-1 h-8 text-xs"
                value={remotePort}
                onChange={(e) => onRemotePortChange(e.target.value)}
                placeholder="5432"
                disabled={disabled}
              />
            </div>
          </div>

          {/* Save as profile + info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                id="save-as-tunnel-profile"
                checked={saveAsProfile}
                onCheckedChange={(checked) =>
                  onSaveAsProfileChange(checked === true)
                }
              />
              <Label
                htmlFor="save-as-tunnel-profile"
                className="cursor-pointer text-xs text-muted-foreground"
              >
                Save as tunnel profile
              </Label>
            </div>
          </div>

          {remoteHost && remotePort && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <IconInfoCircle className="h-3 w-3 shrink-0" />
              Tunnel will forward localhost:(auto) &rarr; {remoteHost}:
              {remotePort}
            </p>
          )}
        </div>
      )}

      {/* Saved Profile mode */}
      {tunnelMode === "profile" && (
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="tunnel-profile" className="text-xs">
              Tunnel Profile
            </Label>
            {tunnelProfiles.length > 0 ? (
              <Select
                value={tunnelProfileId}
                onValueChange={(v) => {
                  if (v) onTunnelProfileIdChange(v);
                }}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue placeholder="Select tunnel profile...">
                    {tunnelProfiles.find((p) => p.id === tunnelProfileId)
                      ?.name ?? "Select tunnel profile..."}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {tunnelProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 h-8 w-full justify-start gap-1.5 text-xs text-muted-foreground"
                onClick={openTunnelSettings}
              >
                <IconPlus className="h-3 w-3" />
                Create tunnel profile...
              </Button>
            )}
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-8">
              <Label htmlFor="tunnel-profile-remote-host" className="text-xs">
                Remote Host
              </Label>
              <Input
                id="tunnel-profile-remote-host"
                className="mt-1 h-8 text-xs"
                value={remoteHost}
                onChange={(e) => onRemoteHostChange(e.target.value)}
                placeholder="cluster.xxx.rds.amazonaws.com"
                disabled={disabled}
              />
            </div>
            <div className="col-span-4">
              <Label htmlFor="tunnel-profile-remote-port" className="text-xs">
                Remote Port
              </Label>
              <Input
                id="tunnel-profile-remote-port"
                className="mt-1 h-8 text-xs"
                value={remotePort}
                onChange={(e) => onRemotePortChange(e.target.value)}
                placeholder="5432"
                disabled={disabled}
              />
            </div>
          </div>

          {remoteHost && remotePort && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <IconInfoCircle className="h-3 w-3 shrink-0" />
              Tunnel will forward localhost:(auto) &rarr; {remoteHost}:
              {remotePort}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
