import { nanoid } from "nanoid";
import type {
  CrudCommand,
  CrudCommandTarget,
  TriggerDefinitionInput,
  TriggerCreatePayload,
  TriggerDropPayload,
  TriggerTogglePayload,
} from "@/types/crud";

export function generateCommandId(): string {
  return nanoid();
}

export function createTriggerCreateCommand(
  target: CrudCommandTarget,
  definition: Partial<TriggerDefinitionInput>,
  tempId?: string,
): CrudCommand<TriggerCreatePayload> {
  return {
    id: generateCommandId(),
    type: "trigger.create",
    target,
    payload: {
      definition: {
        name: definition.name || "",
        timing: definition.timing || "BEFORE",
        events: definition.events || ["INSERT"],
        functionName: definition.functionName || "",
        level: definition.level || "ROW",
        condition: definition.condition,
        enabled: definition.enabled ?? true,
        comment: definition.comment,
      },
      tempId: tempId || generateCommandId(),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Create trigger ${definition.name || "(unnamed)"}`,
    },
    state: "staged",
  };
}

export function createTriggerDropCommand(
  target: CrudCommandTarget,
  triggerName: string,
  ifExists = true,
): CrudCommand<TriggerDropPayload> {
  return {
    id: generateCommandId(),
    type: "trigger.drop",
    target,
    payload: {
      triggerName,
      ifExists,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Drop trigger ${triggerName}`,
    },
    state: "staged",
  };
}

export function createTriggerEnableCommand(
  target: CrudCommandTarget,
  triggerName: string,
): CrudCommand<TriggerTogglePayload> {
  return {
    id: generateCommandId(),
    type: "trigger.enable",
    target,
    payload: {
      triggerName,
      enable: true,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Enable trigger ${triggerName}`,
    },
    state: "staged",
  };
}

export function createTriggerDisableCommand(
  target: CrudCommandTarget,
  triggerName: string,
): CrudCommand<TriggerTogglePayload> {
  return {
    id: generateCommandId(),
    type: "trigger.disable",
    target,
    payload: {
      triggerName,
      enable: false,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      description: `Disable trigger ${triggerName}`,
    },
    state: "staged",
  };
}
