import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderConfig } from "../types";

export const googleConfig: ProviderConfig = {
  id: "google",
  name: "Google",
  requiresApiKey: true,
  models: [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      description: "Fast and capable",
    },
    {
      id: "gemini-2.0-flash-lite",
      name: "Gemini 2.0 Flash Lite",
      description: "Lightweight",
    },
    {
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      description: "Advanced reasoning",
    },
  ],
};

export function createGoogleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}
