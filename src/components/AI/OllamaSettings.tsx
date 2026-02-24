/**
 * Ollama Settings Component
 *
 * Shows Ollama connection status and configuration.
 * Displayed in the AI panel when Ollama is the selected agent.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  IconCheck,
  IconX,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useAcpStore } from "@/stores/acpStore";
import type { ModelInfo } from "@/types/acp";

const OLLAMA_AGENT_ID = "ollama";

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

export function OllamaSettings() {
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const fetchModelsForAgent = useAcpStore((s) => s.fetchModelsForAgent);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const agent = availableAgents.find((a) => a.id === OLLAMA_AGENT_ID);
  const isInstalled = agent?.installed ?? false;

  const testConnection = useCallback(async () => {
    setStatus("testing");
    setErrorMessage(null);

    try {
      const models = await invoke<ModelInfo[] | null>("acp_fetch_agent_models", {
        agentId: OLLAMA_AGENT_ID,
      });

      if (models && models.length > 0) {
        setStatus("connected");
        void fetchModelsForAgent(OLLAMA_AGENT_ID);
      } else {
        setStatus("error");
        setErrorMessage("Ollama is running but no models found. Pull one with: ollama pull qwen2.5-coder:7b");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Cannot connect to Ollama. Make sure it is running (ollama serve).");
    }
  }, [fetchModelsForAgent]);

  // Only show for Ollama agent
  if (selectedAgentId !== OLLAMA_AGENT_ID) return null;

  if (!isInstalled) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/50 rounded-md mx-2 mb-2">
        <IconX className="h-3.5 w-3.5 text-destructive shrink-0" />
        <div className="flex-1 min-w-0">
          <p>Ollama is not running</p>
          <p className="text-[10px] mt-0.5">
            Install from{" "}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              ollama.com
            </a>
            {" "}and run <code className="bg-muted px-1 rounded">ollama serve</code>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => {
            void useAcpStore.getState().loadAgents();
          }}
        >
          <IconRefresh className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-md mx-2 mb-2">
      {status === "testing" ? (
        <IconLoader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      ) : status === "connected" ? (
        <IconCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
      ) : status === "error" ? (
        <IconX className="h-3.5 w-3.5 text-destructive shrink-0" />
      ) : (
        <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        {status === "error" && errorMessage ? (
          <p className="text-[10px] text-destructive">{errorMessage}</p>
        ) : (
          <p className="text-[11px]">
            Local AI via Ollama — private, no cloud
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px]"
        onClick={() => void testConnection()}
        disabled={status === "testing"}
      >
        Test
      </Button>
    </div>
  );
}
