import type { CollectionDesignerState } from "./types";

/**
 * Build the raw MongoDB `createCollection` command object from form state.
 * Returns only the options portion (without `create` key) so the caller can
 * add the collection name.
 */
export function buildCreateCommand(
  state: CollectionDesignerState,
): Record<string, unknown> {
  const cmd: Record<string, unknown> = {
    create: state.collectionName.trim(),
  };

  // Capped
  if (state.cappedEnabled) {
    cmd.capped = true;
    const size = Number.parseInt(state.cappedSize, 10);
    if (!Number.isNaN(size) && size > 0) cmd.size = size;
    const max = Number.parseInt(state.cappedMax, 10);
    if (!Number.isNaN(max) && max > 0) cmd.max = max;
  }

  // Time Series
  if (state.timeSeriesEnabled && state.timeField.trim()) {
    const ts: Record<string, unknown> = {
      timeField: state.timeField.trim(),
    };
    if (state.metaField.trim()) ts.metaField = state.metaField.trim();
    ts.granularity = state.granularity;
    cmd.timeseries = ts;

    const expire = Number.parseInt(state.expireAfterSeconds, 10);
    if (!Number.isNaN(expire) && expire > 0) cmd.expireAfterSeconds = expire;
  }

  // Clustered Index
  if (state.clusteredEnabled) {
    const clustered: Record<string, unknown> = {
      key: { _id: 1 },
      unique: true,
    };
    if (state.clusteredName.trim()) clustered.name = state.clusteredName.trim();
    cmd.clusteredIndex = clustered;

    const expire = Number.parseInt(state.clusteredExpireAfterSeconds, 10);
    if (!Number.isNaN(expire) && expire > 0) cmd.expireAfterSeconds = expire;
  }

  // Collation — always include all fields the user can see/edit
  if (state.collationEnabled) {
    const collation: Record<string, unknown> = {
      locale: state.collationLocale,
    };
    const strength = Number.parseInt(state.collationStrength, 10);
    if (!Number.isNaN(strength) && strength >= 1 && strength <= 5) {
      collation.strength = strength;
    }
    collation.caseLevel = state.collationCaseLevel;
    collation.caseFirst = state.collationCaseFirst;
    collation.numericOrdering = state.collationNumericOrdering;
    collation.alternate = state.collationAlternate;
    collation.maxVariable = state.collationMaxVariable;
    collation.backwards = state.collationBackwards;
    cmd.collation = collation;
  }

  // Validation — only include level/action when validator parses successfully
  if (state.validationEnabled) {
    try {
      const validator = JSON.parse(state.validatorJson.trim());
      if (validator && typeof validator === "object" && !Array.isArray(validator)) {
        cmd.validator = validator;
        cmd.validationLevel = state.validationLevel;
        cmd.validationAction = state.validationAction;
      }
    } catch {
      // Invalid JSON — omit from command, will be caught during save validation
    }
  }

  return cmd;
}

/**
 * Build a human-readable preview of the `db.createCollection()` command
 * plus an optional `insertOne()` for the seed document.
 */
export function buildPreviewText(state: CollectionDesignerState): string {
  const name = state.collectionName.trim() || "<collection>";
  const cmd = buildCreateCommand(state);

  // Remove `create` from the display options – it's part of the method call
  const { create: _, ...options } = cmd;

  const hasOptions = Object.keys(options).length > 0;

  let preview: string;
  if (hasOptions) {
    preview = `db.createCollection("${name}", ${JSON.stringify(options, null, 2)})`;
  } else {
    preview = `db.createCollection("${name}")`;
  }

  if (state.seedEnabled) {
    let seedDisplay: string;
    try {
      const parsed = JSON.parse(state.seedJson.trim());
      seedDisplay = JSON.stringify(parsed, null, 2);
    } catch {
      seedDisplay = state.seedJson.trim() || "{}";
    }
    preview += `\n\ndb.${name}.insertOne(${seedDisplay})`;
  }

  return preview;
}
