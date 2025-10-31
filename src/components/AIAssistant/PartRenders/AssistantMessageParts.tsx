import type {
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  StepStartUIPart,
  ToolUIPart,
  UIMessage,
} from "ai";
import { ExternalLink, FileText, Sparkles } from "lucide-react";
import { TextPart } from "./TextPart";
import { ToolCallDisplay } from "./ToolCallDisplay";

interface AssistantMessagePartsProps {
  message: UIMessage;
}

type MessagePart = UIMessage["parts"][number];
type DataPart = Extract<MessagePart, { type: `data-${string}` }>;

/**
 * Renders all assistant message parts returned by the Vercel AI SDK UI v2
 * (text, tool invocations, data parts, etc.).
 */
export function AssistantMessageParts({ message }: AssistantMessagePartsProps) {
  let stepCounter = 0;

  return (
    <>
      {message.parts.map((part, index) => {
        const partType = part.type;

        if (isStepStartPart(part)) {
          stepCounter += 1;
          return (
            <StepMarker
              key={`${message.id}-step-${stepCounter}`}
              step={stepCounter}
            />
          );
        }

        if (part.type === "text") {
          return (
            <TextPart
              key={`${message.id}-text-${index}`}
              id={message.id}
              content={part.text}
            />
          );
        }

        if (isReasoningPart(part)) {
          return (
            <ReasoningBubble
              key={`${message.id}-reasoning-${index}`}
              part={part}
            />
          );
        }

        if (isToolPart(part)) {
          return (
            <div
              className="not-prose"
              key={`${message.id}-tool-${part.toolCallId}`}
            >
              <ToolCallDisplay
                toolName={extractToolName(part.type)}
                toolCallId={part.toolCallId}
                state={part.state}
                input={"input" in part ? part.input : undefined}
                output={"output" in part ? part.output : undefined}
                errorText={"errorText" in part ? part.errorText : undefined}
                providerExecuted={
                  "providerExecuted" in part ? part.providerExecuted : undefined
                }
                preliminary={
                  "preliminary" in part ? part.preliminary : undefined
                }
                rawInput={"rawInput" in part ? part.rawInput : undefined}
              />
            </div>
          );
        }

        if (isDynamicToolPart(part)) {
          return (
            <div
              className="not-prose"
              key={`${message.id}-dynamic-tool-${part.toolCallId}`}
            >
              <ToolCallDisplay
                toolName={part.toolName}
                toolCallId={part.toolCallId}
                state={part.state}
                input={"input" in part ? part.input : undefined}
                output={"output" in part ? part.output : undefined}
                errorText={"errorText" in part ? part.errorText : undefined}
                preliminary={
                  "preliminary" in part ? part.preliminary : undefined
                }
              />
            </div>
          );
        }

        if (isSourceUrlPart(part)) {
          return (
            <SourceLink
              key={`${message.id}-source-url-${part.sourceId}`}
              part={part}
            />
          );
        }

        if (isSourceDocumentPart(part)) {
          return (
            <SourceDocumentCard
              key={`${message.id}-source-document-${part.sourceId}`}
              part={part}
            />
          );
        }

        if (isFilePart(part)) {
          return (
            <FileAttachment key={`${message.id}-file-${index}`} part={part} />
          );
        }

        if (isDataPart(part)) {
          return (
            <DataPreview
              key={`${message.id}-${partType}-${index}`}
              partType={partType}
              data={part.data}
            />
          );
        }

        console.warn("⚠️ Unknown part type:", partType);
        return (
          <UnknownPart
            key={`${message.id}-unknown-${index}`}
            partType={partType}
          />
        );
      })}
    </>
  );
}

function isStepStartPart(part: MessagePart): part is StepStartUIPart {
  return part.type === "step-start";
}

function isReasoningPart(part: MessagePart): part is ReasoningUIPart {
  return part.type === "reasoning";
}

function isToolPart(part: MessagePart): part is ToolUIPart {
  return typeof part.type === "string" && part.type.startsWith("tool-");
}

function isDynamicToolPart(part: MessagePart): part is DynamicToolUIPart {
  return part.type === "dynamic-tool";
}

function isSourceUrlPart(part: MessagePart): part is SourceUrlUIPart {
  return part.type === "source-url";
}

function isSourceDocumentPart(part: MessagePart): part is SourceDocumentUIPart {
  return part.type === "source-document";
}

function isFilePart(part: MessagePart): part is FileUIPart {
  return part.type === "file";
}

function isDataPart(part: MessagePart): part is DataPart {
  return typeof part.type === "string" && part.type.startsWith("data-");
}

function extractToolName(type: ToolUIPart["type"]) {
  return type.replace(/^tool-/, "");
}

function StepMarker({ step }: { step: number }) {
  return (
    <div
      className="not-prose my-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80"
      aria-label={`Step ${step}`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground">
        {step}
      </span>
      <span>Step {step}</span>
    </div>
  );
}

function ReasoningBubble({ part }: { part: ReasoningUIPart }) {
  return (
    <div className="not-prose my-2 flex items-start gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-2 text-[11px] text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
      <p className="whitespace-pre-line leading-relaxed">{part.text}</p>
    </div>
  );
}

function SourceLink({ part }: { part: SourceUrlUIPart }) {
  return (
    <a
      href={part.url}
      target="_blank"
      rel="noreferrer"
      className="not-prose group my-1 flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <ExternalLink className="h-3 w-3 flex-shrink-0 group-hover:text-primary" />
      <span className="truncate">
        {part.title?.trim() || part.url.replace(/^https?:\/\//, "")}
      </span>
    </a>
  );
}

function SourceDocumentCard({ part }: { part: SourceDocumentUIPart }) {
  return (
    <div className="not-prose my-2 space-y-1 rounded-md border border-border bg-muted/40 p-2 text-[11px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        <span className="font-medium">{part.title}</span>
      </div>
      <div className="text-muted-foreground/80">
        <div>
          <span className="font-semibold">Type:</span> {part.mediaType}
        </div>
        {part.filename && (
          <div>
            <span className="font-semibold">File:</span> {part.filename}
          </div>
        )}
      </div>
    </div>
  );
}

function FileAttachment({ part }: { part: FileUIPart }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
      <FileText className="h-3.5 w-3.5" />
      <div className="min-w-0">
        <div className="truncate font-medium">{part.url.split("/").pop()}</div>
        <div className="text-muted-foreground/80">{part.mediaType}</div>
      </div>
    </div>
  );
}

function DataPreview({ partType, data }: { partType: string; data: unknown }) {
  return (
    <div className="not-prose my-2 rounded-md border border-dashed border-border bg-muted/40 p-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {partType.replace(/^data-/, "").replace(/-/g, " ")}
      </div>
      <pre className="max-h-64 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
        {formatData(data)}
      </pre>
    </div>
  );
}

function UnknownPart({ partType }: { partType: string }) {
  return (
    <div className="not-prose my-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
      Unsupported part type: <span className="font-semibold">{partType}</span>
    </div>
  );
}

function formatData(data: unknown) {
  if (data === null || data === undefined) {
    return String(data);
  }

  if (typeof data === "string") {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
