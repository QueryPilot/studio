import { useState, useCallback, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  getAIProviders,
  createSession,
  sendChatMessage,
  listSessionMessages,
  type AISession,
  listAICommands,
  type AICommandDefinition,
  runAICommand,
  renderCommandTemplate,
  listAIAgents,
  type AIAgent,
} from "@/services/opencodeService";
import { type Message, type TableMention } from "./types";
import { useAIStore } from "@/stores/aiStore";
import { useToast } from "@/hooks/use-toast";
import { databaseService } from "@/services/databaseService";
import { schemaCache } from "@/services/schemaCache";
import { useConnectionStore } from "@/stores/connectionStore";
import type { TableStructure } from "@/types/tableStructure";

interface ChatAssistantProps {
  connectionId: string;
}

export function ChatAssistant({ connectionId }: ChatAssistantProps) {
  const selectedModel = useAIStore((s) => s.selectedModel);
  const setSelectedModel = useAIStore((s) => s.setSelectedModel);
  const selectedAgent = useAIStore((s) => s.selectedAgent);
  const setSelectedAgent = useAIStore((s) => s.setSelectedAgent);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_providers, setProviders] = useState<
    {
      id: string;
      name: string;
      models: { id: string; name?: string }[];
      default_model?: string;
    }[]
  >([]);
  const [currentSession, setCurrentSession] = useState<AISession | null>(null);
  const [commands, setCommands] = useState<AICommandDefinition[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [tableSuggestions, setTableSuggestions] = useState<
    Array<{ name: string; schema: string; kind?: string; type?: string }>
  >([]);
  const [_versions, setVersions] = useState<{
    opencode?: string;
    codex?: string;
    _source?: "cli" | "manifest";
  }>({});
  const selectedAgentRef = useRef(selectedAgent);

  const connection = useConnectionStore(
    useCallback((state) => state.getConnection(connectionId), [connectionId]),
  );
  const connectionName = connection ? connection.name : "Unknown connection";
  const connectionDatabase = connection?.database ?? "";
  const [resolvedDatabase, setResolvedDatabase] = useState<string>(
    () => connection?.database ?? "",
  );
  const ensuredConnectionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);
  const { toast } = useToast();

  const ensureBackendConnection = useCallback(async () => {
    if (!isTauri()) return;
    if (!connectionId) return;

    const ensuredSet = ensuredConnectionsRef.current;
    if (ensuredSet.has(connectionId)) return;

    try {
      await databaseService.connectById(connectionId, connection?.workspace);
      schemaCache.setConnection(connectionId);
      ensuredSet.add(connectionId);
    } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    if (/already\s+connected/i.test(message)) {
      ensuredSet.add(connectionId);
    } else {
      console.warn(
        `[AI] Failed to ensure backend connection for ${connectionId}`,
          error,
        );
      }
    }
  }, [connection?.workspace, connectionId]);

  const ensureSessionId = useCallback(async (): Promise<string | null> => {
    if (currentSession?.id) return currentSession.id;
    const session = await createSession();
    if (session?.id) {
      setCurrentSession(session);
      return session.id;
    }
    return null;
  }, [currentSession?.id]);

  // Load providers and set default model
  useEffect(() => {
    if (!isTauri()) return;

    const loadProviders = async () => {
      try {
        const providerList = await getAIProviders();
        setProviders(providerList);

        // Set default model: first provider's default or first model
        if (!selectedModel && providerList.length > 0) {
          const firstProvider = providerList[0];
          if (firstProvider) {
            const candidate =
              firstProvider.default_model ?? firstProvider.models[0]?.id ?? "";
            if (candidate) {
              const qualified: string = candidate.includes("/")
                ? candidate
                : `${firstProvider.id}/${candidate}`;
              setSelectedModel(qualified);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load providers:", error);
      }
    };

    void loadProviders();
  }, [selectedModel, setSelectedModel]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const DEVDB_AGENT_IDS = new Set([
      "devdb-agent",
      "sql-expert",
      "schema-architect",
      "performance-analyst",
      "data-guardian",
    ]);

    const loadConnectionDatabase = async () => {
      if (resolvedDatabase || !connectionId) return;
      try {
        await ensureBackendConnection();
        const list = await databaseService.listDatabases(connectionId);
        const dbName = list[0] ?? "";
        if (!cancelled) {
          setResolvedDatabase(dbName);
        }
      } catch (error) {
        console.warn("[AI] Failed to resolve database name", error);
      }
    };

    const loadCommands = async () => {
      setCommandsLoading(true);
      try {
        const commandList = await listAICommands();
        if (!cancelled) {
          setCommands(commandList);
        }
      } catch (error) {
        console.error("Failed to load AI commands:", error);
        if (!cancelled) {
          setCommands([]);
        }
      } finally {
        if (!cancelled) {
          setCommandsLoading(false);
        }
      }
    };

    const loadAgents = async () => {
      try {
        const agentList = await listAIAgents();
        if (cancelled) return;
        const filtered = agentList.filter((agent) =>
          DEVDB_AGENT_IDS.has(agent.id),
        );
        const effectiveAgents = filtered.length > 0 ? filtered : [];
        setAgents(effectiveAgents);
        const currentSelection = selectedAgentRef.current;
        const defaultAgent = effectiveAgents.find(
          (agent) => agent.id === "devdb-agent",
        );
        if (effectiveAgents.length === 0) {
          if (currentSelection) setSelectedAgent("");
          return;
        }
        const existing = effectiveAgents.find(
          (agent) => agent.id === currentSelection,
        );
        if (!existing) {
          if (defaultAgent) setSelectedAgent(defaultAgent.id);
          else setSelectedAgent(effectiveAgents[0].id);
        }
      } catch (error) {
        console.error("Failed to load AI agents:", error);
        if (!cancelled) {
          setAgents([]);
          const currentSelection = selectedAgentRef.current;
          if (currentSelection) setSelectedAgent("");
        }
      }
    };

    const loadTables = async () => {
      if (!connectionId || !isTauri()) return;
      try {
        await ensureBackendConnection();
        const database = resolvedDatabase || connectionDatabase;

        let schemaNames: string[] = [];
        try {
          schemaNames = await databaseService.listSchemas(connectionId, database);
        } catch (error) {
          console.warn("[AI] Failed to list schemas", error);
        }

        if (schemaNames.length === 0) {
          schemaNames = ["public", "dbo", "main"];
        }

        const collected: Array<{
          name: string;
          schema: string;
          kind?: string;
          type?: string;
        }> = [];

        for (const schemaName of schemaNames) {
          if (cancelled) return;
          try {
            const tables = await databaseService.listTables(
              connectionId,
              database,
              schemaName,
            );
            tables.forEach((table) => {
              const kind = table.kind;
              const type =
                kind === "View" || kind === "MaterializedView"
                  ? "view"
                  : "table";
              collected.push({
                name: table.name,
                schema: table.schema,
                kind,
                type,
              });
            });
          } catch (error) {
            console.warn(
              `[AI] Failed to load tables for schema ${schemaName}`,
              error,
            );
          }
        }

        if (!cancelled) {
          setTableSuggestions(collected);
        }
      } catch (error) {
        console.warn("[AI] Failed to load table suggestions", error);
      }
    };

    void loadConnectionDatabase();
    void loadCommands();
    void loadAgents();
    void loadTables();

    void (async () => {
      try {
        unlisten = await listen("ai:opencode-init", () => {
          void loadCommands();
          void loadAgents();
          void loadTables();
        });
      } catch (error) {
        console.warn("[AI] Failed to attach opencode-init listener", error);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [
    connectionDatabase,
    connectionId,
    ensureBackendConnection,
    resolvedDatabase,
    setSelectedAgent,
  ]);

  useEffect(() => {
    if (connectionDatabase && connectionDatabase !== resolvedDatabase) {
      setResolvedDatabase(connectionDatabase);
    }
  }, [connectionDatabase, resolvedDatabase]);

  useEffect(() => {
    if (!connectionId || !isTauri()) return;
    void ensureBackendConnection();
  }, [connectionId, ensureBackendConnection]);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<Array<{ tool: string; version?: string; source?: string }>>(
      "get_ai_sidecar_versions",
    )
      .then((list) => {
        const map: { [k: string]: string | undefined } = {};
        let src: "cli" | "manifest" | undefined;
        list.forEach((it) => {
          if (it.version) map[it.tool] = it.version;
          if (!src && (it.source === "cli" || it.source === "manifest")) {
            src = it.source;
          }
        });
        setVersions({
          opencode: map["opencode"],
          codex: map["codex"],
          _source: src,
        });
        const oc = map["opencode"] || "-";
        const cx = map["codex"] || "-";
        console.info(
          `[AI] sidecars: opencode=${oc} codex=${cx} source=${
            src ?? "unknown"
          }`,
        );
      })
      .catch(() => {
        /* ignore for now */
      });
  }, []);

  const handleSendMessage = useCallback(
    async (content: string, mentions: TableMention[]) => {
      const sessionId = await ensureSessionId();
      if (!sessionId) {
        console.error("No session available");
        return;
      }

      // Add user message to UI
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
        mentions: mentions.length > 0 ? mentions : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Create assistant message placeholder
      const assistantMessageId = (Date.now() + 1).toString();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        model: selectedModel,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      try {
        await ensureBackendConnection();
        const metadataBlock = await buildMetadataBlock(
          connectionId,
          connectionName,
          resolvedDatabase,
          mentions,
        );

        const promptToSend = metadataBlock
          ? `${content}\n\n${metadataBlock}`
          : content;

        console.info("[AI] Sending prompt", {
          connectionId,
          agent: selectedAgent || "devdb-agent",
          prompt: promptToSend,
        });

        // Send message to OpenCode with streaming
        await sendChatMessage(sessionId, promptToSend, {
          model:
            selectedModel && selectedModel.trim().length > 0
              ? selectedModel
              : "opencode/default",
          agent: selectedAgent || undefined,
          onStream: (chunk) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: msg.content + chunk }
                  : msg,
              ),
            );
          },
          onComplete: async () => {
            // Wait a moment for any final streaming chunks to arrive
            await new Promise((resolve) => setTimeout(resolve, 100));

            try {
              // Always fetch the latest message from the server to ensure completeness
              const hist = await listSessionMessages(sessionId);
              const last = [...hist]
                .reverse()
                .find((m) => m.role === "assistant" && m.content);

              if (last && last.content.length > 0) {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === assistantMessageId) {
                      // Always update with the server's complete message
                      // This ensures we have the full content even if streaming was partial
                      return {
                        ...msg,
                        content: last.content,
                        model: last.model || msg.model,
                      };
                    }
                    return msg;
                  }),
                );
              }
            } catch (e) {
              console.error("Failed to fetch assistant message:", e);
            } finally {
              // Always clear loading state after everything is done
              setIsLoading(false);
            }
          },
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        setIsLoading(false);

        // Show error message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content:
                    "Sorry, I encountered an error processing your message.",
                }
              : msg,
          ),
        );
      }
    },
    [
      selectedModel,
      connectionId,
      connectionName,
      ensureBackendConnection,
      resolvedDatabase,
      ensureSessionId,
      selectedAgent,
    ],
  );

  const handleRunCommand = useCallback(
    async (command: AICommandDefinition, args: Record<string, string>) => {
      const sessionId = await ensureSessionId();
      if (!sessionId) {
        toast({
          title: "No session",
          description: "Unable to create a chat session for this command.",
          variant: "destructive",
        });
        return;
      }

      const commandPrompt = renderCommandTemplate(command.template, args);
      const displayContent = `/${command.name}\n\n${commandPrompt}`;
      const userMessageId = `${Date.now()}-cmd-user`;
      const assistantMessageId = `${Date.now() + 1}-cmd-assistant`;

      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: "user",
          content: displayContent,
          timestamp: new Date(),
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          model: command.model || selectedModel,
        },
      ]);
      setIsLoading(true);

      try {
        await ensureBackendConnection();
        await runAICommand(sessionId, command, args, selectedAgent || undefined);

        const history = await listSessionMessages(sessionId);
        const last = [...history]
          .reverse()
          .find((m) => m.role === "assistant" && m.content);

        if (last && last.content.length > 0) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: last.content,
                    model: last.model || msg.model,
                  }
                : msg,
            ),
          );
        }
      } catch (error) {
        console.error("Failed to execute AI command:", error);
        let description: string;
        if (error instanceof Error) description = error.message;
        else if (typeof error === "string") description = error;
        else description = "Unknown error";
        toast({
          title: "Command failed",
          description,
          variant: "destructive",
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: "Sorry, the command failed to run.",
                }
              : msg,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      ensureBackendConnection,
      ensureSessionId,
      selectedModel,
      toast,
      selectedAgent,
    ],
  );

  const handleSessionChange = useCallback((session: AISession) => {
    setCurrentSession(session);
    // Clear messages when switching sessions
    setMessages([]);
  }, []);

  // Load messages whenever session changes
  useEffect(() => {
    if (!isTauri()) return;
    const sid = currentSession?.id;
    if (!sid) return;
    // placeholder for future streaming cancellation
    let _cancelled = false;
    void _cancelled;
    void (async () => {
      try {
        const raw = await listSessionMessages(sid);
        const mapped: Message[] = raw.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
          model: m.model,
        }));
        setMessages(mapped);
      } catch (e) {
        console.error("Failed to load session messages:", e);
      }
    })();
    return () => {
      _cancelled = true;
    };
  }, [currentSession?.id]);

  return (
    <div className="flex flex-col h-full bg-background">
      <ChatHeader
        selectedSession={currentSession}
        onSessionChange={handleSessionChange}
        onSettingsClick={() => {}}
        isBusy={isLoading || commandsLoading}
      />

      <ChatMessages messages={messages} isLoading={isLoading} />

      <ChatInput
        onSendMessage={handleSendMessage}
        disabled={isLoading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        agents={agents}
        selectedAgent={selectedAgent}
        onAgentChange={isTauri() ? setSelectedAgent : undefined}
        commands={commands}
        commandsLoading={commandsLoading}
        onRunCommand={isTauri() ? handleRunCommand : undefined}
        tables={tableSuggestions}
      />
    </div>
  );
}

async function buildMetadataBlock(
  connectionId: string,
  connectionName: string,
  database: string,
  mentions: TableMention[],
): Promise<string> {
  if (!isTauri()) return "";

  try {
    await databaseService.connectById(connectionId);
    schemaCache.setConnection(connectionId);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    if (!/already\s+connected/i.test(message)) {
      console.warn(
        `[AI] Failed to ensure backend connection before metadata build for ${connectionId}`,
        error,
      );
    }
  }

  const uniqueMentions = new Map<string, TableMention>();
  mentions.forEach((mention) => {
    if (!mention.table) return;
    const schema = mention.schema ?? "public";
    uniqueMentions.set(`${schema}.${mention.table}`, {
      ...mention,
      schema,
    });
  });

  const tableSchemas: Array<Record<string, unknown>> = [];

  for (const mention of uniqueMentions.values()) {
    if (!database) {
      continue;
    }
    try {
      const structure: TableStructure = await databaseService.getTableStructure(
        connectionId,
        database,
        mention.schema ?? "public",
        mention.table,
        {
          includeConstraints: true,
          includeIndexes: true,
          includeStatistics: true,
          includeTriggers: true,
          includeForeignKeys: true,
        },
      );

      tableSchemas.push({
        name: structure.name,
        schema: structure.schema,
        database: structure.database,
        rowCount: structure.rowCount,
        size: structure.size,
        comment: structure.comment ?? undefined,
        columns: structure.columns.map((column) => ({
          name: column.name,
          data_type: column.db_type,
          nullable: column.nullable,
          default:
            (column as { default?: string | null }).default ??
            (column as { default_value?: string | null }).default_value ??
            undefined,
          is_primary_key: column.is_pk,
          is_foreign_key: column.is_fk,
          enum_values: column.enum_values ?? undefined,
          comment: column.comment ?? undefined,
        })),
        indexes: structure.indexes,
        foreign_keys: structure.foreignKeys,
        constraints: structure.constraints,
        triggers: structure.triggers,
        stats: structure.stats,
      });
    } catch (error) {
      console.warn(
        `[AI] Failed to build table metadata for ${mention.schema}.${mention.table}`,
        error,
      );
    }
  }

  const metadataLines = [
    "<metadata>",
    "<connection_info>",
    `- connection_id: ${connectionId}`,
    `- connection_name: ${connectionName}`,
    `- database: ${database || ""}`,
    "</connection_info>",
    "",
    "<table_schemas>",
    tableSchemas.length > 0
      ? JSON.stringify(tableSchemas, null, 2)
      : "[]",
    "</table_schemas>",
    "</metadata>",
  ];

  return metadataLines.join("\n");
}
