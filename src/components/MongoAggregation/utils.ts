// ---------------------------------------------------------------------------
// Aggregation pipeline utilities
// ---------------------------------------------------------------------------

type AggregationParseResult =
  | { ok: true; pipeline: object[] }
  | { ok: false; error: string };

export const DEFAULT_STAGE_TEMPLATES: Record<string, string> = {
  $match: JSON.stringify({ $match: {} }, null, 2),
  $group: JSON.stringify(
    { $group: { _id: "$field", count: { $sum: 1 } } },
    null,
    2,
  ),
  $sort: JSON.stringify({ $sort: { createdAt: -1 } }, null, 2),
  $project: JSON.stringify({ $project: { _id: 0 } }, null, 2),
  $limit: JSON.stringify({ $limit: 50 }, null, 2),
  $unwind: JSON.stringify({ $unwind: "$field" }, null, 2),
  $lookup: JSON.stringify(
    {
      $lookup: {
        from: "otherCollection",
        localField: "field",
        foreignField: "_id",
        as: "joined",
      },
    },
    null,
    2,
  ),
  $addFields: JSON.stringify({ $addFields: { newField: "$existing" } }, null, 2),
};

/** Parse an array of JSON stage strings into a validated pipeline. */
export function parseAggregationStages(
  stages: string[],
): AggregationParseResult {
  const pipeline: object[] = [];

  for (let index = 0; index < stages.length; index += 1) {
    const stageText = stages[index]?.trim() ?? "";
    if (!stageText) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stageText);
    } catch (error) {
      return {
        ok: false,
        error: `Stage ${index + 1} has invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Stage ${index + 1} must be a JSON object`,
      };
    }

    pipeline.push(parsed);
  }

  return { ok: true, pipeline };
}

// ---------------------------------------------------------------------------
// Stage color mapping — each operator gets a unique color scheme
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<string, string> = {
  $match: "text-green-400 border-green-500/30 bg-green-500/5",
  $group: "text-purple-400 border-purple-500/30 bg-purple-500/5",
  $sort: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  $project: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  $limit: "text-red-400 border-red-500/30 bg-red-500/5",
  $unwind: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  $lookup: "text-pink-400 border-pink-500/30 bg-pink-500/5",
  $addFields: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
};

/** Detect the operator name from a JSON stage string (e.g. "$match"). */
export function detectStageType(stageJson: string): string {
  try {
    const parsed = JSON.parse(stageJson);
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed as Record<string, unknown>);
      const firstKey = keys[0];
      if (firstKey !== undefined && firstKey.startsWith("$")) return firstKey;
    }
  } catch {
    /* ignore */
  }
  return "$stage";
}

/** Get Tailwind color classes for a given stage operator. */
export function getStageColorClasses(stageType: string): string {
  return (
    STAGE_COLORS[stageType] ??
    "text-muted-foreground border-border bg-muted/20"
  );
}
