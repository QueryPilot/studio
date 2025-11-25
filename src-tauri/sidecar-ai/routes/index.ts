import { handleHealth } from "./health";
import { handleStatus } from "./status";
import { handleConfig } from "./config";
import { handleProviders } from "./providers";
import { handleChatStream } from "./chat";
import { handleTextToSQL } from "./text-to-sql";
import { handleOpenRouterModels } from "./openrouter-models";

export const routes = {
  "/health": handleHealth,
  "/status": handleStatus,
  "/config": handleConfig,
  "/providers": handleProviders,
  "/chat": handleChatStream,
  "/text-to-sql": handleTextToSQL,
  "/openrouter-models": handleOpenRouterModels,
};
