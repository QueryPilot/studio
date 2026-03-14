import type { ValidationRules } from "@/adapters/types/mongodb";

export type MongoCollectionViewType =
  | "data"
  | "structure"
  | "indexes"
  | "aggregation"
  | "validation"
  | "explain";

export type MongoExplainSource = "data" | "aggregation";

export interface MongoWorkbenchState {
  filterText?: string;
  aggregationStages?: string[];
  validationJson?: string;
  validationLevel?: ValidationRules["validationLevel"];
  validationAction?: ValidationRules["validationAction"];
  explainSource?: MongoExplainSource;
  structureSampleSize?: number;
  structureMaxDepth?: number;
  dataViewMode?: "table" | "tree" | "json";
  aggregationStageEnabled?: boolean[];
  aggregationViewMode?: "visual" | "code";
}

export const DEFAULT_MONGO_WORKBENCH_STATE: MongoWorkbenchState = {
  filterText: "",
  aggregationStages: [],
  validationJson: "",
  validationLevel: "strict",
  validationAction: "error",
  explainSource: "data",
  structureSampleSize: 500,
  structureMaxDepth: 4,
  dataViewMode: "table",
  aggregationStageEnabled: [],
  aggregationViewMode: "visual",
};
