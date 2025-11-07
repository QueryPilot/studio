import { CrudCommandFactory } from "./crudCommandFactory";
import { useCrudStore } from "@/stores/crudStore";
import type {
  CrudCommand,
  CrudCommandFor,
  CrudCommandTarget,
  IndexDefinitionInput,
} from "@/types/crud";

interface BaseIndexParams {
  readonly target: CrudCommandTarget;
  readonly userId?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly stage?: boolean;
}

export interface CreateIndexParams extends BaseIndexParams {
  readonly definition: IndexDefinitionInput;
}

export interface DropIndexParams extends BaseIndexParams {
  readonly indexName: string;
  readonly ifExists?: boolean;
}

export interface RenameIndexParams extends BaseIndexParams {
  readonly indexName: string;
  readonly newName: string;
}

const validateIndexDefinition = (definition: IndexDefinitionInput): void => {
  if (!definition.name || definition.name.trim() === "") {
    throw new Error("IndexOperationsService: definition.name is required");
  }
  if (definition.columns.length === 0) {
    throw new Error(
      "IndexOperationsService: definition.columns must include at least one column",
    );
  }
};

const stageCommand = (command: CrudCommand, shouldStage = true): void => {
  if (!shouldStage) {
    return;
  }
  useCrudStore.getState().stageCommand(command);
};

export const IndexOperationsService = {
  createIndex(params: CreateIndexParams): CrudCommandFor<"index.create"> {
    validateIndexDefinition(params.definition);

    const command = CrudCommandFactory.createIndexCreateCommand({
      target: params.target,
      definition: params.definition,
      userId: params.userId,
      description:
        params.description ??
        `Create index ${params.definition.name} on ${
          params.target.table ?? "table"
        }`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  },

  dropIndex(params: DropIndexParams): CrudCommandFor<"index.drop"> {
    if (!params.indexName || params.indexName.trim() === "") {
      throw new Error(
        "IndexOperationsService: indexName is required for dropIndex",
      );
    }

    const command = CrudCommandFactory.createIndexDropCommand({
      target: params.target,
      indexName: params.indexName,
      ifExists: params.ifExists,
      userId: params.userId,
      description:
        params.description ??
        `Drop index ${params.indexName} on ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  },

  renameIndex(params: RenameIndexParams): CrudCommandFor<"index.rename"> {
    if (!params.indexName || params.indexName.trim() === "") {
      throw new Error(
        "IndexOperationsService: indexName is required for renameIndex",
      );
    }
    if (!params.newName || params.newName.trim() === "") {
      throw new Error(
        "IndexOperationsService: newName is required for renameIndex",
      );
    }

    const command = CrudCommandFactory.createIndexRenameCommand({
      target: params.target,
      indexName: params.indexName,
      newName: params.newName,
      userId: params.userId,
      description:
        params.description ??
        `Rename index ${params.indexName} to ${params.newName} on ${
          params.target.table ?? "table"
        }`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  },
};

export const indexOperationsService = IndexOperationsService;
