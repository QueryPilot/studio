export type {
  VariableSyntax,
  VariableType,
  VariableScope,
  ParsedVariable,
  QueryVariable,
} from "./types";
export { variableKey, isPositionalSyntax } from "./types";
export { parseVariables, neutralizeVariables, type ParseResult, type ParseVariablesOptions } from "./parser";
export { substituteVariables, substituteStatementVariables, type SubstitutionResult } from "./substitution";
export { inferVariableType } from "./defaults";
