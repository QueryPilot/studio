import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ToolUIPart } from "ai";
import { cn } from "@/lib/utils";

interface ToolCallDisplayProps {
  toolName: string;
  toolCallId: string;
  state: ToolInvocationState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  providerExecuted?: boolean;
  preliminary?: boolean;
  rawInput?: unknown;
}

export function ToolCallDisplay({
  toolName,
  toolCallId,
  state,
  input,
  output,
  errorText,
  providerExecuted,
  preliminary,
  rawInput,
}: ToolCallDisplayProps) {
  const { status, statusMessage, derivedError } = deriveStatus({
    state,
    output,
    errorText,
    preliminary,
  });

  const theme = STATUS_THEME[status];

  const displayInput =
    input !== undefined && !isMeaninglessObject(input)
      ? input
      : rawInput && !isMeaninglessObject(rawInput)
      ? rawInput
      : undefined;

  return (
    <div
      className={cn(
        "my-3 rounded-xl border bg-background p-4 text-xs shadow-sm",
        theme.container,
      )}
    >
      <div className="flex flex-col gap-3">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full",
                theme.iconBg,
              )}
            >
              {theme.icon}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-semibold text-foreground">
                  {formatToolName(toolName)}
                </span>
                <StatusBadge status={status} />
                {providerExecuted && <Chip label="Provider execution" />}
                {preliminary && status === "success" && (
                  <Chip label="Preliminary" />
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/90">
                {statusMessage}
              </p>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
            Call ID · {toolCallId}
          </div>
        </header>

        {displayInput !== undefined && (
          <CollapsibleSection label="Input" defaultOpen={false}>
            <StructuredValue value={displayInput} />
          </CollapsibleSection>
        )}

        {status === "error" && (derivedError || errorText) && (
          <CollapsibleSection label="Error">
            <p className="text-[11px] leading-relaxed text-destructive">
              {derivedError || errorText}
            </p>
          </CollapsibleSection>
        )}

        {output !== undefined && status !== "error" && (
          <CollapsibleSection
            label={preliminary ? "Preliminary Output" : "Output"}
          >
            <StructuredValue value={output} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "success" | "error" }) {
  const { label, badge } = STATUS_THEME[status];
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.12em]",
        badge,
      )}
    >
      {label}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border/70 bg-background/60 px-2 py-[1px] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </span>
  );
}

function formatToolName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    if (typeof value === "object") {
      return "[Complex Object]";
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }
    return "[Unknown]";
  }
}

function isMeaninglessObject(value: unknown) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).length === 0;
}

type ToolInvocationState = ToolUIPart["state"];

const STATUS_THEME = {
  pending: {
    label: "Pending",
    container: "border-blue-200/40",
    badge: "border-blue-200/70 bg-blue-500/10 text-blue-600",
    icon: (
      <Loader2 className="h-4 w-4 animate-spin text-blue-500" aria-hidden />
    ),
    iconBg: "bg-blue-500/10",
  },
  success: {
    label: "Success",
    container: "border-emerald-200/40",
    badge: "border-emerald-200/70 bg-emerald-500/10 text-emerald-600",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />,
    iconBg: "bg-emerald-500/10",
  },
  error: {
    label: "Error",
    container: "border-destructive/40",
    badge: "border-destructive/60 bg-destructive/10 text-destructive",
    icon: <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden />,
    iconBg: "bg-destructive/10",
  },
} satisfies Record<
  "pending" | "success" | "error",
  {
    label: string;
    container: string;
    badge: string;
    icon: ReactNode;
    iconBg: string;
  }
>;

function deriveStatus({
  state,
  output,
  errorText,
  preliminary,
}: {
  state: ToolInvocationState;
  output: unknown;
  errorText?: string;
  preliminary?: boolean;
}): {
  status: "pending" | "success" | "error";
  statusMessage: string;
  derivedError?: string;
} {
  if (state === "output-error") {
    return {
      status: "error",
      statusMessage: "Tool execution failed.",
      derivedError: errorText,
    };
  }

  if (state === "output-available") {
    const failure = extractFailure(output);
    if (failure) {
      return {
        status: "error",
        statusMessage: "Tool reported an error.",
        derivedError: failure,
      };
    }

    return {
      status: "success",
      statusMessage: preliminary
        ? "Preliminary tool output available."
        : "Tool completed successfully.",
    };
  }

  if (state === "input-available") {
    return {
      status: "pending",
      statusMessage: "Inputs collected. Executing tool…",
    };
  }

  return {
    status: "pending",
    statusMessage: "Collecting tool input…",
  };
}

function extractFailure(output: unknown): string | undefined {
  if (output === null || output === undefined) {
    return undefined;
  }

  if (typeof output === "object") {
    const maybeRecord = output as Record<string, unknown>;

    if (typeof maybeRecord.error === "string") {
      return maybeRecord.error;
    }

    if (typeof maybeRecord.success === "boolean" && !maybeRecord.success) {
      if (typeof maybeRecord.message === "string") {
        return maybeRecord.message;
      }

      return "Tool reported failure.";
    }
  }

  return undefined;
}

function CollapsibleSection({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-md border border-border/70 bg-background/60">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted/60"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        <span>{label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 py-2">{children}</div>
      )}
    </div>
  );
}

function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-[11px] text-muted-foreground">{String(value)}</span>
    );
  }

  if (typeof value === "string") {
    return <CodeBlock value={value} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <CodeBlock value="[]" />;
    }

    if (value.every(isPlainObject)) {
      return <TableView rows={value} />;
    }

    return (
      <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
        {value.map((item, index) => (
          <li key={index}>
            <StructuredValue value={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (isPlainObject(value)) {
    const record = value;

    if (isTableCollection(record)) {
      return (
        <div className="space-y-3">
          {record.tables.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No tables found.
            </p>
          ) : (
            <TableView rows={record.tables} />
          )}
        </div>
      );
    }

    return (
      <dl className="grid grid-cols-1 gap-2 text-[11px] text-muted-foreground">
        {Object.entries(record).map(([key, entry]) => (
          <div
            key={key}
            className="rounded border border-border/70 bg-background/80 p-2"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {key}
            </div>
            <StructuredValue value={entry} />
          </div>
        ))}
      </dl>
    );
  }

  return <CodeBlock value={value} />;
}

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
      {formatValue(value)}
    </pre>
  );
}

function TableView({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((key) => set.add(key));
    }
    return Array.from(set);
  }, [rows]);

  return (
    <div className="overflow-x-auto rounded border border-border/70">
      <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-border/60 px-3 py-2 font-semibold"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-background even:bg-muted/30">
              {columns.map((column) => (
                <td
                  key={column}
                  className="border-b border-border/30 px-3 py-2 align-top"
                >
                  <span className="text-muted-foreground">
                    {formatTableCell(row[column])}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTableCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Complex Object]";
    }
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "[Unknown]";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isTableCollection(
  value: Record<string, unknown>,
): value is { tables: Array<Record<string, unknown>> } {
  const tables = value.tables;
  return Array.isArray(tables) && tables.every((item) => isPlainObject(item));
}
