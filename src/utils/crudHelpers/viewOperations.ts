import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  ViewDefinitionInput,
  ViewCreatePayload,
  ViewDropPayload,
  ViewReplacePayload,
  ViewRenamePayload,
} from "@/types/crud";

export function generateCommandId(): string {
  return nanoid();
}

export function createViewCreateCommand(
  target: CrudCommandTarget,
  definition: Partial<ViewDefinitionInput>,
  tempId?: string,
): CrudCommand<ViewCreatePayload> {
  return {
    id: generateCommandId(),
    type: "view.create",
    target,
    payload: {
      definition: {
        name: definition.name || "",
        definition: definition.definition || "",
        isMaterialized: definition.isMaterialized ?? false,
        comment: definition.comment,
        checkOption: definition.checkOption,
        securityBarrier: definition.securityBarrier,
        securityInvoker: definition.securityInvoker,
      },
      tempId: tempId || generateCommandId(),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Create ${definition.isMaterialized ? "materialized " : ""}view ${definition.name || "(unnamed)"}`,
    },
    state: "staged",
  };
}

export function createViewDropCommand(
  target: CrudCommandTarget,
  viewName: string,
  cascade = false,
  isMaterialized = false,
  ifExists = true,
): CrudCommand<ViewDropPayload> {
  return {
    id: generateCommandId(),
    type: "view.drop",
    target,
    payload: {
      viewName,
      ifExists,
      cascade,
      isMaterialized,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Drop ${isMaterialized ? "materialized " : ""}view ${viewName}`,
    },
    state: "staged",
  };
}

export function createViewReplaceCommand(
  target: CrudCommandTarget,
  viewName: string,
  definition: string,
  isMaterialized = false,
): CrudCommand<ViewReplacePayload> {
  return {
    id: generateCommandId(),
    type: "view.replace",
    target,
    payload: {
      viewName,
      definition,
      isMaterialized,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Replace ${isMaterialized ? "materialized " : ""}view ${viewName}`,
    },
    state: "staged",
  };
}

export function createViewRenameCommand(
  target: CrudCommandTarget,
  viewName: string,
  newName: string,
  isMaterialized = false,
): CrudCommand<ViewRenamePayload> {
  return {
    id: generateCommandId(),
    type: "view.rename",
    target,
    payload: {
      viewName,
      newName,
      isMaterialized,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Rename ${isMaterialized ? "materialized " : ""}view ${viewName} to ${newName}`,
    },
    state: "staged",
  };
}

