/**
 * Agent Selector Component
 *
 * Compact dropdown for selecting AI agents.
 * Shows installed/available status with agent logos.
 */

import { useState, useMemo } from "react";
import { useTheme } from "@/components/theme-provider";
import { useAcpStore } from "@/stores/acpStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconSparkles,
  IconRobot,
} from "@tabler/icons-react";
import type { AgentInfo } from "@/types/acp";
import { AgentInstallDialog } from "./AgentInstallDialog";
import { cn } from "@/lib/utils";

// Agent logo mappings (light theme versions, dark theme uses -dark suffix)
const AGENT_LOGOS: Record<string, { light: string; dark: string }> = {
  "claude-code-acp": {
    light: "/logos/claude-color.svg",
    dark: "/logos/claude-color.svg",
  },
  "gemini": {
    light: "/logos/gemini-color.svg",
    dark: "/logos/gemini-color.svg",
  },
  "codex-acp": {
    light: "/logos/openai.svg",
    dark: "/logos/openai.svg",
  },
  "opencode": {
    light: "/logos/opencode-logo-light.svg",
    dark: "/logos/opencode-logo-dark.svg",
  },
};

/** Get logo path for an agent based on current theme */
function getAgentLogo(agentId: string, isDark: boolean): string | null {
  const logos = AGENT_LOGOS[agentId];
  if (!logos) return null;
  return isDark ? logos.dark : logos.light;
}

/** Agent logo component with fallback */
function AgentLogo({ agentId, className }: { agentId: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const logo = getAgentLogo(agentId, isDark);

  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn("h-4 w-4 object-contain", className)}
      />
    );
  }

  // Fallback icon
  return <IconRobot className={cn("h-4 w-4 text-muted-foreground", className)} />;
}

export function AgentSelector() {
  const { availableAgents, selectedAgentId, selectAgent, isLoadingAgents } =
    useAcpStore();

  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [selectedForInstall, setSelectedForInstall] = useState<AgentInfo | null>(
    null
  );

  // Group agents
  const { installedAgents, availableToInstall } = useMemo(() => {
    const installed: AgentInfo[] = [];
    const available: AgentInfo[] = [];

    for (const agent of availableAgents) {
      if (agent.installed) {
        installed.push(agent);
      } else {
        available.push(agent);
      }
    }

    return { installedAgents: installed, availableToInstall: available };
  }, [availableAgents]);

  // Loading state
  if (isLoadingAgents) {
    return (
      <Button variant="ghost" size="sm" disabled className="h-6 gap-1.5 px-2">
        <IconLoader2 className="h-3 w-3 animate-spin" />
        <span className="text-[11px]">Checking...</span>
      </Button>
    );
  }

  // No agents at all
  if (availableAgents.length === 0) {
    return (
      <a
        href="https://docs.querypilot.dev/ai-setup"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 h-6 px-2 text-sm font-medium rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <IconSparkles className="h-3 w-3" />
        <span className="text-[11px]">Setup AI</span>
      </a>
    );
  }

  const selectedAgent = availableAgents.find((a) => a.id === selectedAgentId);

  const handleSelect = (agent: AgentInfo) => {
    if (!agent.installed) {
      setSelectedForInstall(agent);
      setShowInstallDialog(true);
      return;
    }
    selectAgent(agent.id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <Button
              {...props}
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              {selectedAgent ? (
                <AgentLogo agentId={selectedAgent.id} className="h-4 w-4" />
              ) : (
                <IconSparkles className="h-4 w-4" />
              )}
            </Button>
          )}
        />

        <DropdownMenuContent align="end" className="w-48">
          {/* Installed Agents */}
          {installedAgents.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                Installed
              </DropdownMenuLabel>
              {installedAgents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onClick={() => { handleSelect(agent); }}
                  className="gap-2"
                >
                  <AgentLogo agentId={agent.id} className="h-4 w-4" />
                  <span className="flex-1 text-[12px]">{agent.name}</span>
                  {agent.id === selectedAgentId && (
                    <IconCheck className="h-3 w-3 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}

          {/* Available to Install */}
          {availableToInstall.length > 0 && (
            <>
              {installedAgents.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                  Available
                </DropdownMenuLabel>
                {availableToInstall.map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    onClick={() => { handleSelect(agent); }}
                    className={cn("gap-2 text-muted-foreground")}
                  >
                    <AgentLogo agentId={agent.id} className="h-4 w-4 opacity-50" />
                    <span className="flex-1 text-[12px]">{agent.name}</span>
                    <IconDownload className="h-3 w-3" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Install Dialog */}
      <AgentInstallDialog
        agent={selectedForInstall}
        open={showInstallDialog}
        onOpenChange={setShowInstallDialog}
      />
    </>
  );
}
