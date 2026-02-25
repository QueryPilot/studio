import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderConfig } from "../types";

export const googleConfig: ProviderConfig = {
  id: "google",
  name: "Google",
  requiresApiKey: true,
  logo: "/logos/gemini-color.svg",
  models: [
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description: "Fast and capable",
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      description: "Advanced reasoning",
    },
    {
      id: "gemini-3-flash-preview",
      name: "Gemini 3 Flash",
      description: "Latest generation (preview)",
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      description: "Most capable (preview)",
    },
  ],
};

export function createGoogleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}
