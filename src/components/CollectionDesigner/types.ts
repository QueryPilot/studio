// ---------------------------------------------------------------------------
// CollectionDesigner – types, actions, and constants
// ---------------------------------------------------------------------------

/** Granularity options for Time Series collections (MongoDB 5.0+). */
export type TimeSeriesGranularity = "seconds" | "minutes" | "hours";

/** Validation level for document validation rules. */
export type ValidationLevel = "off" | "strict" | "moderate";

/** Validation action for document validation rules. */
export type ValidationAction = "error" | "warn";

/** Collation `caseFirst` options. */
export type CollationCaseFirst = "upper" | "lower" | "off";

/** Collation `alternate` options. */
export type CollationAlternate = "non-ignorable" | "shifted";

/** Collation `maxVariable` options. */
export type CollationMaxVariable = "punct" | "space";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CollectionDesignerState {
  collectionName: string;
  isSaving: boolean;

  // Capped
  cappedEnabled: boolean;
  cappedSize: string;
  cappedMax: string;

  // Time Series (5.0+)
  timeSeriesEnabled: boolean;
  timeField: string;
  metaField: string;
  granularity: TimeSeriesGranularity;
  expireAfterSeconds: string;

  // Clustered Index (5.3+)
  clusteredEnabled: boolean;
  clusteredName: string;
  clusteredExpireAfterSeconds: string;

  // Collation
  collationEnabled: boolean;
  collationLocale: string;
  collationStrength: string;
  collationCaseLevel: boolean;
  collationCaseFirst: CollationCaseFirst;
  collationNumericOrdering: boolean;
  collationAlternate: CollationAlternate;
  collationMaxVariable: CollationMaxVariable;
  collationBackwards: boolean;

  // Validation
  validationEnabled: boolean;
  validatorJson: string;
  validationLevel: ValidationLevel;
  validationAction: ValidationAction;

  // Seed document
  seedEnabled: boolean;
  seedJson: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type CollectionDesignerAction =
  | { type: "SET_FIELD"; field: keyof CollectionDesignerState; value: CollectionDesignerState[keyof CollectionDesignerState] }
  | { type: "TOGGLE_CAPPED"; enabled: boolean }
  | { type: "TOGGLE_TIME_SERIES"; enabled: boolean }
  | { type: "TOGGLE_CLUSTERED"; enabled: boolean }
  | { type: "TOGGLE_COLLATION"; enabled: boolean }
  | { type: "TOGGLE_VALIDATION"; enabled: boolean }
  | { type: "TOGGLE_SEED"; enabled: boolean }
  | { type: "SET_SAVING"; value: boolean };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INITIAL_STATE: CollectionDesignerState = {
  collectionName: "",
  isSaving: false,

  cappedEnabled: false,
  cappedSize: "1048576",
  cappedMax: "",

  timeSeriesEnabled: false,
  timeField: "",
  metaField: "",
  granularity: "seconds",
  expireAfterSeconds: "",

  clusteredEnabled: false,
  clusteredName: "",
  clusteredExpireAfterSeconds: "",

  collationEnabled: false,
  collationLocale: "simple",
  collationStrength: "1",
  collationCaseLevel: false,
  collationCaseFirst: "off",
  collationNumericOrdering: false,
  collationAlternate: "non-ignorable",
  collationMaxVariable: "punct",
  collationBackwards: false,

  validationEnabled: false,
  validatorJson: "{\n  \n}",
  validationLevel: "strict",
  validationAction: "error",

  seedEnabled: false,
  seedJson: "{\n  \n}",
};

/**
 * Common ICU locale identifiers supported by MongoDB collation.
 * Sorted alphabetically for Select display.
 */
export const COLLATION_LOCALES = [
  "simple",
  "af",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "en_US",
  "eo",
  "es",
  "et",
  "fa",
  "fi",
  "fil",
  "fr",
  "ga",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "ky",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "my",
  "nb",
  "nl",
  "nn",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tk",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh",
  "zh_Hant",
] as const;
