export type QueryExecutionStatus =
  | "idle"
  | "executing"
  | "streaming"
  | "success"
  | "error"
  | "cancelled";
