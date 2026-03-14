import { memo } from "react";

// ---------------------------------------------------------------------------
// Stage color classification
// ---------------------------------------------------------------------------

type StageColor = "green" | "red" | "blue" | "default";

const GREEN_STAGES = new Set(["IXSCAN", "FETCH"]);
const RED_STAGES = new Set(["COLLSCAN"]);
const BLUE_STAGES = new Set(["SORT", "PROJECTION", "SORT_KEY_GENERATOR"]);

function classifyStage(stage: string): StageColor {
  const upper = stage.toUpperCase();
  if (GREEN_STAGES.has(upper)) return "green";
  if (RED_STAGES.has(upper)) return "red";
  if (BLUE_STAGES.has(upper)) return "blue";
  return "default";
}

const STAGE_COLOR_CLASSES: Record<StageColor, string> = {
  green: "border-green-500/30 bg-green-500/5",
  red: "border-red-500/30 bg-red-500/5",
  blue: "border-blue-500/30 bg-blue-500/5",
  default: "border-border bg-muted/20",
};

const STAGE_TEXT_CLASSES: Record<StageColor, string> = {
  green: "text-green-600 dark:text-green-400",
  red: "text-red-600 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  default: "text-foreground",
};

// ---------------------------------------------------------------------------
// Key detail extraction
// ---------------------------------------------------------------------------

/** Keys that are displayed as detail items on stage cards. */
const DETAIL_KEYS = new Set([
  "indexName",
  "keyPattern",
  "indexBounds",
  "filter",
  "direction",
  "nReturned",
  "docsExamined",
  "keysExamined",
  "executionTimeMillisEstimate",
]);

function extractDetails(
  record: Record<string, unknown>,
): Array<{ key: string; value: string }> {
  const details: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(record)) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    const display =
      typeof value === "object"
        ? JSON.stringify(value)
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
    details.push({ key, value: display });
  }
  return details;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExplainTreeProps {
  data: Record<string, unknown>;
  label: string;
}

// ---------------------------------------------------------------------------
// Recursive node renderer
// ---------------------------------------------------------------------------

function ExplainNode({
  label,
  data,
  depth,
}: {
  label: string;
  data: Record<string, unknown>;
  depth: number;
}) {
  const stage =
    typeof data.stage === "string"
      ? data.stage
      : typeof data.nodeType === "string"
        ? data.nodeType
        : label;

  const color = classifyStage(stage);
  const details = extractDetails(data);

  // Find child nodes: object-typed values that are not arrays and not detail keys
  const children = Object.entries(data).filter(
    ([key, value]) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !DETAIL_KEYS.has(key),
  );

  // Numeric stats for the badge
  const nReturned = typeof data.nReturned === "number" ? data.nReturned : null;
  const keysExamined =
    typeof data.keysExamined === "number" ? data.keysExamined : null;
  const docsExamined =
    typeof data.docsExamined === "number" ? data.docsExamined : null;

  return (
    <div className={depth > 0 ? "mt-2 border-l-2 border-muted-foreground/20 pl-4" : ""}>
      <div
        className={`rounded-md border p-2.5 ${STAGE_COLOR_CLASSES[color]}`}
      >
        {/* Stage header */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${STAGE_TEXT_CLASSES[color]}`}>
            {stage}
          </span>
          {nReturned !== null && (
            <span className="text-[11px] text-muted-foreground">
              {nReturned} docs
            </span>
          )}
          {keysExamined !== null && (
            <span className="text-[11px] text-muted-foreground">
              {keysExamined} keys
            </span>
          )}
          {docsExamined !== null && nReturned === null && (
            <span className="text-[11px] text-muted-foreground">
              {docsExamined} docs examined
            </span>
          )}
        </div>

        {/* Detail items */}
        {details.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {details
              .filter(
                (d) =>
                  d.key !== "nReturned" &&
                  d.key !== "keysExamined" &&
                  d.key !== "docsExamined",
              )
              .map((d) => (
                <div key={d.key} className="flex gap-1 text-[11px]">
                  <span className="font-medium text-muted-foreground">
                    {d.key}:
                  </span>
                  <span className="truncate font-mono text-foreground/80">
                    {d.value}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Child nodes */}
      {children.length > 0 && (
        <div className="space-y-0">
          {children.map(([childKey, childValue]) => (
            <ExplainNode
              key={`${childKey}-${depth + 1}`}
              label={childKey}
              data={childValue as Record<string, unknown>}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export const ExplainTree = memo(function ExplainTree({
  data,
  label,
}: ExplainTreeProps) {
  return <ExplainNode label={label} data={data} depth={0} />;
});
