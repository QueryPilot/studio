import { useState, useEffect } from "react";
import { Sparkles, Settings, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  listSessions,
  createSession,
  type AISession,
} from "@/services/opencodeService";
import { isTauri } from "@tauri-apps/api/core";

interface ChatHeaderProps {
  selectedSession: AISession | null;
  onSessionChange: (session: AISession) => void;
  onSettingsClick?: () => void;
}

export function ChatHeader({
  selectedSession,
  onSessionChange,
  onSettingsClick,
}: ChatHeaderProps) {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const sessionList = await listSessions();
      setSessions(sessionList);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  };

  const handleCreateSession = async () => {
    setLoading(true);
    try {
      const session = await createSession();
      if (session) {
        await loadSessions();
        onSessionChange(session);
        setSessionOpen(false);
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between h-8 px-3 border-b">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-blue-500" />

        {/* Session selector */}
        <Popover open={sessionOpen} onOpenChange={setSessionOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs font-normal"
              disabled={loading}
            >
              <span className="truncate max-w-[200px]">
                {selectedSession ? selectedSession.title : "New Session"}
              </span>
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search sessions..." className="text-xs" />
              <CommandList>
                <CommandEmpty>No sessions found.</CommandEmpty>

                {/* New Session option */}
                <CommandItem
                  onSelect={handleCreateSession}
                  className="text-xs"
                >
                  <Plus className="mr-2 h-3 w-3" />
                  New Session
                </CommandItem>

                {/* Existing sessions */}
                {sessions.length > 0 && (
                  <CommandGroup heading="Recent Sessions">
                    {sessions.map((session) => (
                      <CommandItem
                        key={session.id}
                        value={session.title}
                        onSelect={() => {
                          onSessionChange(session);
                          setSessionOpen(false);
                        }}
                        className="text-xs"
                      >
                        <span className="truncate">{session.title}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {onSettingsClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onSettingsClick}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
