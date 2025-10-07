import { isTauri, safeInvoke, safeListen } from "@/utils/tauri";

export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  createdAt: number;
}

export interface AISessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChunkEventPayload {
  session_id: string;
  content: string;
}

export interface CompleteEventPayload {
  session_id: string;
}

export interface ErrorEventPayload {
  session_id: string;
  message: string;
}

type AIEventMap = {
  chunk: (payload: ChunkEventPayload) => void;
  complete: (payload: CompleteEventPayload) => void;
  error: (payload: ErrorEventPayload) => void;
};

interface SessionSummaryRaw {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface MessageRaw {
  id: string;
  role: AIMessageRole;
  content: string;
  created_at: number;
}

class AIService {
  private listeners: Map<keyof AIEventMap, Set<(payload: unknown) => void>> =
    new Map();
  private unsubscribers: (() => void)[] = [];
  private listening = false;

  private normalizeSession(raw: SessionSummaryRaw): AISessionSummary {
    return {
      id: raw.id,
      title: raw.title,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      messageCount: raw.message_count,
    };
  }

  private normalizeMessage(raw: MessageRaw): AIMessage {
    return {
      id: raw.id,
      role: raw.role,
      content: raw.content,
      createdAt: raw.created_at,
    };
  }

  private emit(event: keyof AIEventMap, payload: unknown) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;

    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`AI event listener for "${event}" failed`, error);
      }
    });
  }

  private async ensureEventBridge() {
    if (this.listening || !isTauri()) {
      return;
    }

    const chunkUnlisten = await safeListen<ChunkEventPayload>("ai:chunk", (event) => {
      this.emit("chunk", event.payload);
    });

    const completeUnlisten = await safeListen<CompleteEventPayload>(
      "ai:complete",
      (event) => {
        this.emit("complete", event.payload);
      },
    );

    const errorUnlisten = await safeListen<ErrorEventPayload>("ai:error", (event) => {
      this.emit("error", event.payload);
    });

    [chunkUnlisten, completeUnlisten, errorUnlisten]
      .filter((fn): fn is () => void => typeof fn === "function")
      .forEach((fn) => {
        this.unsubscribers.push(fn);
      });

    this.listening = true;
  }

  on<E extends keyof AIEventMap>(event: E, callback: AIEventMap[E]) {
    void this.ensureEventBridge();
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const listeners = this.listeners.get(event)!;
    const wrapped = (payload: unknown) => {
      callback(payload as Parameters<AIEventMap[E]>[0]);
    };

    listeners.add(wrapped);

    return () => {
      listeners.delete(wrapped);
    };
  }

  async createSession(title?: string): Promise<AISessionSummary | null> {
    const response = await safeInvoke<SessionSummaryRaw>("create_ai_session", {
      title,
    });

    if (!response) {
      return null;
    }

    return this.normalizeSession(response);
  }

  async listSessions(): Promise<AISessionSummary[]> {
    const response = await safeInvoke<SessionSummaryRaw[]>("list_ai_sessions");
    if (!response) {
      return [];
    }
    return response.map((session) => this.normalizeSession(session));
  }

  async getHistory(sessionId: string): Promise<AIMessage[]> {
    const response = await safeInvoke<MessageRaw[]>("get_ai_session_history", {
      sessionId,
    });

    if (!response) {
      return [];
    }

    return response.map((message) => this.normalizeMessage(message));
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await safeInvoke("send_ai_message_streaming", {
      sessionId,
      message,
    });
  }

  dispose() {
    this.unsubscribers.forEach((unsubscribe) => { unsubscribe(); });
    this.unsubscribers = [];
    this.listening = false;
    this.listeners.clear();
  }
}

export const aiService = new AIService();
