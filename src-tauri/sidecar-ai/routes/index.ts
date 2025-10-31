import { handleHealth } from "./health";
import { handleStatus } from "./status";
import { handleConfig } from "./config";
import { handleProviders } from "./providers";
import { handleChatStream } from "./chat";

export const routes = {
  "/health": handleHealth,
  "/status": handleStatus,
  "/config": handleConfig,
  "/providers": handleProviders,
  "/chat": handleChatStream,
};
