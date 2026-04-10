import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import type { DuckDbCreateSecretRequest } from "@/services/backend";

const SECRET_TYPES = ["S3", "GCS", "AZURE", "R2", "HUGGINGFACE"] as const;
type SecretType = (typeof SECRET_TYPES)[number];

const PROVIDERS = [
  { value: "CONFIG", label: "Config" },
  { value: "CREDENTIAL_CHAIN", label: "Credential Chain" },
] as const;

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "sa-east-1",
  "ca-central-1",
] as const;

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
}

const TYPE_FIELDS: Record<SecretType, FieldDef[]> = {
  S3: [
    { key: "KEY_ID", label: "Access Key ID", placeholder: "AKIA...", required: true },
    { key: "SECRET", label: "Secret Access Key", placeholder: "wJalrX...", required: true, secret: true },
    { key: "REGION", label: "Region", placeholder: "us-east-1" },
    { key: "ENDPOINT", label: "Endpoint (optional)", placeholder: "https://s3.example.com" },
    { key: "URL_STYLE", label: "URL Style", placeholder: "path or vhost" },
  ],
  GCS: [
    { key: "KEY_ID", label: "Access Key ID", required: true },
    { key: "SECRET", label: "Secret", required: true, secret: true },
  ],
  AZURE: [
    { key: "CONNECTION_STRING", label: "Connection String", secret: true },
    { key: "ACCOUNT_NAME", label: "Account Name" },
    { key: "ACCOUNT_KEY", label: "Account Key", secret: true },
  ],
  R2: [
    { key: "KEY_ID", label: "Access Key ID", required: true },
    { key: "SECRET", label: "Secret Access Key", required: true, secret: true },
    { key: "ACCOUNT_ID", label: "Account ID", required: true },
  ],
  HUGGINGFACE: [
    { key: "TOKEN", label: "Token", required: true, secret: true },
  ],
};

interface DuckDbCreateSecretDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (request: DuckDbCreateSecretRequest) => void;
  isSubmitting?: boolean;
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        placeholder={placeholder}
        className="pr-9 font-mono text-[11px]"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => { setVisible((v) => !v); }}
        tabIndex={-1}
      >
        {visible ? (
          <IconEyeOff className="h-3.5 w-3.5" />
        ) : (
          <IconEye className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function DuckDbCreateSecretForm({
  onClose,
  onSubmit,
  isSubmitting = false,
}: Omit<DuckDbCreateSecretDialogProps, "open">) {
  const [name, setName] = useState("");
  const [secretType, setSecretType] = useState<SecretType>("S3");
  const [provider, setProvider] = useState("CONFIG");
  const [persistent, setPersistent] = useState(true);
  const [scope, setScope] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});

  const fields = useMemo(() => TYPE_FIELDS[secretType], [secretType]);

  const updateParam = (key: string, value: string) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit = useMemo(() => {
    if (!name.trim() || isSubmitting) return false;
    return fields
      .filter((f) => f.required)
      .every((f) => (params[f.key] ?? "").trim().length > 0);
  }, [name, fields, params, isSubmitting]);

  const handleSubmit = () => {
    if (!canSubmit) return;

    const filteredParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value.trim()) {
        filteredParams[key] = value.trim();
      }
    }

    onSubmit({
      name: name.trim(),
      secretType,
      provider,
      scope: scope.trim() || null,
      persistent,
      params: filteredParams,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Secret</DialogTitle>
        <DialogDescription>
          Configure credentials for accessing remote storage like S3, GCS, or
          Azure.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <Label htmlFor="secret-name">Secret Name</Label>
          <Input
            id="secret-name"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder="my_s3_secret"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="secret-type">Type</Label>
            <Select
              value={secretType}
              onValueChange={(v) => {
                setSecretType(v as SecretType);
                setParams({});
              }}
            >
              <SelectTrigger id="secret-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECRET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "HUGGINGFACE" ? "Hugging Face" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="secret-provider">Provider</Label>
            <Select value={provider} onValueChange={(v) => { setProvider(v ?? "CONFIG"); }}>
              <SelectTrigger id="secret-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`secret-${field.key}`}>
              {field.label}
              {field.required && (
                <span className="text-destructive ml-0.5">*</span>
              )}
            </Label>
            {field.key === "REGION" ? (
              <Select
                value={params.REGION ?? ""}
                onValueChange={(v) => { updateParam("REGION", v ?? ""); }}
              >
                <SelectTrigger id="secret-REGION">
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {AWS_REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.key === "URL_STYLE" ? (
              <Select
                value={params.URL_STYLE ?? ""}
                onValueChange={(v) => { updateParam("URL_STYLE", v ?? ""); }}
              >
                <SelectTrigger id="secret-URL_STYLE">
                  <SelectValue placeholder="Select style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="path">path</SelectItem>
                  <SelectItem value="vhost">vhost</SelectItem>
                </SelectContent>
              </Select>
            ) : field.secret ? (
              <SecretInput
                value={params[field.key] ?? ""}
                onChange={(v) => { updateParam(field.key, v); }}
                placeholder={field.placeholder}
              />
            ) : (
              <Input
                id={`secret-${field.key}`}
                value={params[field.key] ?? ""}
                onChange={(e) => { updateParam(field.key, e.target.value); }}
                placeholder={field.placeholder}
                className="font-mono text-[11px]"
              />
            )}
          </div>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="secret-scope">Scope (optional)</Label>
          <Input
            id="secret-scope"
            value={scope}
            onChange={(e) => { setScope(e.target.value); }}
            placeholder="s3://my-bucket"
            className="font-mono text-[11px]"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="secret-persistent"
            checked={persistent}
            onCheckedChange={setPersistent}
          />
          <Label htmlFor="secret-persistent" className="text-sm font-normal">
            Persistent (survives restarts)
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {isSubmitting ? "Creating..." : "Create Secret"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DuckDbCreateSecretDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
}: DuckDbCreateSecretDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(openValue) => {
        if (!openValue) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {open && (
          <DuckDbCreateSecretForm
            onClose={onClose}
            onSubmit={onSubmit}
            isSubmitting={isSubmitting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
