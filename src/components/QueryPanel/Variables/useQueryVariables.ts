import { useCallback, useMemo, useState } from "react";
import {
  parseVariables,
  inferVariableType,
  variableKey,
  isPositionalSyntax,
  type QueryVariable,
  type VariableScope,
  type ParseResult,
} from "@/lib/queryVariables";

export interface UseQueryVariablesOptions {
  sql: string;
  /** Seed values applied only on mount. The component is expected to
   *  remount (new key/tabId) when loading a different saved query. */
  initialVariables?: Record<string, QueryVariable>;
  initialScope?: VariableScope;
}

export interface UseQueryVariablesReturn {
  variables: Record<string, QueryVariable>;
  parseResult: ParseResult;
  scope: VariableScope;
  hasVariables: boolean;
  hasPositionalVariables: boolean;
  setVariableValue: (key: string, value: string) => void;
  setVariableType: (key: string, type: QueryVariable["type"]) => void;
  setScope: (scope: VariableScope) => void;
  getVariables: () => Record<string, QueryVariable>;
}

/**
 * Hook that reactively parses SQL for variable placeholders and
 * maintains a merged state of variable values + types.
 *
 * New variables detected in SQL get auto-typed defaults.
 * Variables removed from SQL are pruned.
 * User-set values are preserved across re-parses.
 *
 * `initialVariables` is consumed only on mount (via useState initializer).
 * When the user opens a different saved query, the parent should remount
 * this hook (e.g. via a React key tied to tabId).
 */
export function useQueryVariables({
  sql,
  initialVariables,
  initialScope = "global",
}: UseQueryVariablesOptions): UseQueryVariablesReturn {
  const [scope, setScope] = useState<VariableScope>(initialScope);

  // Seed from initialVariables on mount only — avoids circular deps
  // with the Zustand store write-back in QueryPanel.
  const [userEdits, setUserEdits] = useState<Record<string, Partial<QueryVariable>>>(
    () => {
      if (!initialVariables) return {};
      const edits: Record<string, Partial<QueryVariable>> = {};
      for (const [key, v] of Object.entries(initialVariables)) {
        edits[key] = { value: v.value, type: v.type };
      }
      return edits;
    },
  );

  const parseResult = useMemo(
    () => parseVariables(sql, { scope }),
    [sql, scope],
  );

  const variables = useMemo(() => {
    const result: Record<string, QueryVariable> = {};

    for (const parsed of parseResult.variables) {
      const key = variableKey(parsed.name, parsed.syntax, scope, parsed.statementIndex);
      if (result[key]) continue;

      const edits = userEdits[key];
      result[key] = {
        name: parsed.name,
        value: edits?.value ?? "",
        type: edits?.type ?? (parsed.inListContext ? "list" : inferVariableType(parsed.name)),
        syntax: parsed.syntax,
        statementIndex: scope === "per_statement" ? parsed.statementIndex : undefined,
      };
    }

    return result;
  }, [parseResult, scope, userEdits]);

  const setVariableValue = useCallback((key: string, value: string) => {
    setUserEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], value },
    }));
  }, []);

  const setVariableType = useCallback((key: string, type: QueryVariable["type"]) => {
    setUserEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], type },
    }));
  }, []);

  const getVariables = useCallback(() => variables, [variables]);

  const hasVariables = parseResult.variables.length > 0;
  const hasPositionalVariables = parseResult.variables.some((v) => isPositionalSyntax(v.syntax));

  return {
    variables,
    parseResult,
    scope,
    hasVariables,
    hasPositionalVariables,
    setVariableValue,
    setVariableType,
    setScope,
    getVariables,
  };
}
