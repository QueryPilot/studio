import type {
  QueryPayload,
  QueryResult,
  SelectOptions,
  TableRef,
  WhereClause,
} from "@/adapters/types";

export type BestEffortBlockReason =
  | "invalid_matcher"
  | "not_found"
  | "ambiguous";

export type BestEffortProbeResult =
  | { ok: true; matchCount: 1 }
  | { ok: false; reason: BestEffortBlockReason; matchCount: number };

interface BestEffortProbeAdapter {
  select(target: TableRef, options?: SelectOptions): QueryPayload;
  execute(query: QueryPayload): Promise<QueryResult>;
}

interface CanProceedBestEffortArgs {
  adapter: BestEffortProbeAdapter;
  target: TableRef;
  where: WhereClause;
}

/**
 * Validates a best-effort row matcher by probing the current table snapshot.
 * The operation is safe only when exactly one row matches.
 */
export async function canProceedBestEffort(
  args: CanProceedBestEffortArgs,
): Promise<BestEffortProbeResult> {
  const where = args.where;
  if (Object.keys(where).length === 0) {
    return {
      ok: false,
      reason: "invalid_matcher",
      matchCount: 0,
    };
  }

  const probeQuery = args.adapter.select(args.target, {
    where,
    limit: 2,
  });
  const probeResult = await args.adapter.execute(probeQuery);
  const matchCount = probeResult.rows.length;

  if (matchCount === 1) {
    return { ok: true, matchCount: 1 };
  }

  if (matchCount === 0) {
    return {
      ok: false,
      reason: "not_found",
      matchCount: 0,
    };
  }

  return {
    ok: false,
    reason: "ambiguous",
    matchCount,
  };
}
