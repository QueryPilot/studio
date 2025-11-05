import { CrudCommandFactory } from "./crudCommandFactory";
import { useCrudStore } from "@/stores/crudStore";
import type {
  ColumnDefinitionInput,
  CrudCommandFor,
  CrudCommandTarget,
} from "@/types/crud";

interface BaseStructureParams {
  readonly target: CrudCommandTarget;
  readonly userId?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly stage?: boolean;
}

export interface AddColumnParams extends BaseStructureParams {
  readonly column: ColumnDefinitionInput;
}

export interface ModifyColumnParams extends BaseStructureParams {
  readonly columnName: string;
  readonly newDefinition: ColumnDefinitionInput;
}

export interface DropColumnParams extends BaseStructureParams {
  readonly columnName: string;
  readonly cascade?: boolean;
}

export interface RenameColumnParams extends BaseStructureParams {
  readonly columnName: string;
  readonly newName: string;
}

const validateColumnDefinition = (definition: ColumnDefinitionInput): void => {
  if (!definition.name || definition.name.trim() === "") {
    throw new Error("StructureOperationsService: column name is required");
  }
  if (!definition.dataType || definition.dataType.trim() === "") {
    throw new Error("StructureOperationsService: dataType is required");
  }
};

const stageCommand = (command: CrudCommandFor<any>, shouldStage = true): void => {
  if (!shouldStage) {
    return;
  }
  useCrudStore.getState().stageCommand(command);
};

export class StructureOperationsService {
  static addColumn(params: AddColumnParams): CrudCommandFor<'column.add'> {
    validateColumnDefinition(params.column);

    const command = CrudCommandFactory.createColumnAddCommand({
      target: params.target,
      column: params.column,
      userId: params.userId,
      description:
        params.description ?? `Add column ${params.column.name} to ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }

  static modifyColumn(params: ModifyColumnParams): CrudCommandFor<'column.modify'> {
    validateColumnDefinition(params.newDefinition);

    const command = CrudCommandFactory.createColumnModifyCommand({
      target: params.target,
      columnName: params.columnName,
      newDefinition: params.newDefinition,
      userId: params.userId,
      description:
        params.description ??
        `Modify column ${params.columnName} on ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }

  static dropColumn(params: DropColumnParams): CrudCommandFor<'column.drop'> {
    if (!params.columnName || params.columnName.trim() === "") {
      throw new Error("StructureOperationsService: columnName is required for dropColumn");
    }

    const command = CrudCommandFactory.createColumnDropCommand({
      target: params.target,
      columnName: params.columnName,
      cascade: params.cascade,
      userId: params.userId,
      description:
        params.description ??
        `Drop column ${params.columnName} from ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }

  static renameColumn(params: RenameColumnParams): CrudCommandFor<'column.rename'> {
    if (!params.columnName || params.columnName.trim() === "") {
      throw new Error("StructureOperationsService: columnName is required for renameColumn");
    }
    if (!params.newName || params.newName.trim() === "") {
      throw new Error("StructureOperationsService: newName is required for renameColumn");
    }

    const command = CrudCommandFactory.createColumnRenameCommand({
      target: params.target,
      columnName: params.columnName,
      newName: params.newName,
      userId: params.userId,
      description:
        params.description ??
        `Rename column ${params.columnName} to ${params.newName} on ${params.target.table ?? "table"}`,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  }
}

export const structureOperationsService = StructureOperationsService;

