import { CrudCommandFactory } from "./crudCommandFactory";
import { useCrudStore } from "@/stores/crudStore";
import type {
  CrudCommandFor,
  CrudCommandTarget,
  TriggerDefinitionInput,
} from "@/types/crud";

interface BaseTriggerParams {
  readonly target: CrudCommandTarget;
  readonly userId?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly stage?: boolean;
}

export interface CreateTriggerParams extends BaseTriggerParams {
  readonly definition: TriggerDefinitionInput;
}

export interface DropTriggerParams extends BaseTriggerParams {
  readonly triggerName: string;
  readonly ifExists?: boolean;
}

export interface ToggleTriggerParams extends BaseTriggerParams {
  readonly triggerName: string;
  readonly enable: boolean;
}

const validateTriggerDefinition = (definition: TriggerDefinitionInput): void => {
  if (!definition.name || definition.name.trim() === "") {
    throw new Error("TriggerOperationsService: definition.name is required");
  }
  if (!definition.events || definition.events.length === 0) {
    throw new Error("TriggerOperationsService: definition.events must include at least one event");
  }
  if (!definition.functionName || definition.functionName.trim() === "") {
    throw new Error("TriggerOperationsService: definition.functionName is required");
  }
};

const stageCommand = (command: CrudCommandFor<any>, shouldStage = true): void => {
  if (!shouldStage) {
    return;
  }
  useCrudStore.getState().stageCommand(command);
};

export class TriggerOperationsService {
  static createTrigger(params: CreateTriggerParams): CrudCommandFor<'trigger.create'> {
    validateTriggerDefinition(params.definition);

    const command = CrudCommandFactory.createTriggerCreateCommand({
      target: params.target,
      definition: params.definition,
      userId: params.userId,
      description:
        params.description ??
        `Create trigger ${params.definition.name} on ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }

  static dropTrigger(params: DropTriggerParams): CrudCommandFor<'trigger.drop'> {
    if (!params.triggerName || params.triggerName.trim() === "") {
      throw new Error("TriggerOperationsService: triggerName is required for dropTrigger");
    }

    const command = CrudCommandFactory.createTriggerDropCommand({
      target: params.target,
      triggerName: params.triggerName,
      ifExists: params.ifExists,
      userId: params.userId,
      description:
        params.description ??
        `Drop trigger ${params.triggerName} on ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }

  static toggleTrigger(params: ToggleTriggerParams): CrudCommandFor<'trigger.enable' | 'trigger.disable'> {
    if (!params.triggerName || params.triggerName.trim() === "") {
      throw new Error("TriggerOperationsService: triggerName is required for toggleTrigger");
    }

    const command = CrudCommandFactory.createTriggerToggleCommand({
      target: params.target,
      triggerName: params.triggerName,
      enable: params.enable,
      userId: params.userId,
      description:
        params.description ??
        `${params.enable ? "Enable" : "Disable"} trigger ${params.triggerName} on ${
          params.target.table ?? "table"
        }`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }
}

export const triggerOperationsService = TriggerOperationsService;

