import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConnectionStore } from "@/stores/connectionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { parseDatabaseUri } from "@/lib/databaseUri";
import {
  Database,
  Server,
  FileText,
  Loader2,
  Clipboard,
  Check,
  ChevronDown,
} from "lucide-react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preSelectedWorkspaceId?: string | null;
  editingConnectionId?: string | null;
}

export function ConnectionDialog({
  open,
  onOpenChange,
  preSelectedWorkspaceId,
  editingConnectionId,
}: ConnectionDialogProps) {
  const { addConnection, updateConnection, connect, connections } = useConnectionStore();
  const { workspaces, ensureUncategorizedWorkspace, addConnectionToWorkspace } =
    useWorkspaceStore();
  const [isLoading, setIsLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<string>("uncategorized");
  const [workspacePopoverOpen, setWorkspacePopoverOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    type: "postgresql" as "postgresql" | "mysql" | "sqlite" | "mongodb",
    host: "localhost",
    port: 5432,
    database: "",
    username: "",
    password: "",
    ssl: false,
    filePath: "",
  });

  useEffect(() => {
    // Ensure uncategorized workspace exists
    ensureUncategorizedWorkspace();

    if (open) {
      // If editing existing connection, populate form
      if (editingConnectionId) {
        const connection = connections.get(editingConnectionId);
        if (connection) {
          setFormData({
            name: connection.config.name,
            type: connection.config.type as any,
            host: connection.config.host || "localhost",
            port: connection.config.port || 5432,
            database: connection.config.database,
            username: connection.config.username || "",
            password: connection.config.password || "",
            ssl: connection.config.ssl || false,
            filePath: connection.config.filePath || "",
          });
          setSelectedWorkspaceId(connection.config.workspaceId || "uncategorized");
        }
      } else {
        // Reset form for new connection
        setFormData({
          name: "",
          type: "postgresql",
          host: "localhost",
          port: 5432,
          database: "",
          username: "",
          password: "",
          ssl: false,
          filePath: "",
        });
        // Set pre-selected workspace when dialog opens
        if (preSelectedWorkspaceId) {
          setSelectedWorkspaceId(preSelectedWorkspaceId);
        } else {
          setSelectedWorkspaceId("uncategorized");
        }
        // Auto-check clipboard for new connections only (not when editing)
        if (!editingConnectionId) {
          setTimeout(() => {
            checkClipboard();
          }, 100);
        }
      }
    }

    // Listen for paste events
    const handlePaste = (e: ClipboardEvent) => {
      if (!open) return;
      const text = e.clipboardData?.getData("text");
      if (text) {
        parseAndFillUri(text);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, preSelectedWorkspaceId, editingConnectionId, ensureUncategorizedWorkspace, connections]);

  const checkClipboard = async () => {
    try {
      const text = await readText();
      if (text && text.trim()) {
        const parsed = parseDatabaseUri(text);
        if (parsed) {
          parseAndFillUri(text);
          toast.success("Database URI auto-filled from clipboard");
        } else {
          toast.error("Invalid database URI in clipboard");
        }
      } else {
        toast.info("No text found in clipboard");
      }
    } catch (error) {
      console.error("Failed to read clipboard:", error);
      toast.error("Failed to read clipboard");
    }
  };

  const parseAndFillUri = (uri: string) => {
    const parsed = parseDatabaseUri(uri);
    if (parsed) {
      setFormData((prev) => ({
        ...prev,
        type: parsed.type,
        host: parsed.host || prev.host,
        port: parsed.port || prev.port,
        database: parsed.database || prev.database,
        username: parsed.username || prev.username,
        password: parsed.password || prev.password,
        ssl: parsed.ssl ?? prev.ssl,
        filePath: parsed.filePath || prev.filePath,
      }));

      // Auto-generate name if empty
      if (!formData.name && parsed.database) {
        setFormData((prev) => ({
          ...prev,
          name: `${parsed.type} - ${parsed.database}`,
        }));
      }
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setTestStatus("idle");
  };

  const handleTypeChange = (type: string) => {
    const defaultPorts: Record<string, number> = {
      postgresql: 5432,
      mysql: 3306,
      mongodb: 27017,
    };

    setFormData((prev) => ({
      ...prev,
      type: type as any,
      port: defaultPorts[type] || 5432,
    }));
    setTestStatus("idle");
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");

    try {
      const testConfig = {
        id: crypto.randomUUID(),
        name:
          formData.name ||
          `${formData.type} - ${formData.database || "database"}`,
        type: formData.type,
        host: formData.host,
        port: formData.port,
        database: formData.database,
        username: formData.username,
        password: formData.password,
        ssl: formData.ssl,
        filePath: formData.filePath,
      };

      const success = await useConnectionStore
        .getState()
        .testConnection(testConfig);

      if (success) {
        setTestStatus("success");
        // No toast for success - just show in UI
      } else {
        setTestStatus("error");
        toast.error("Failed to connect: Connection refused");
      }
    } catch (error) {
      setTestStatus("error");
      toast.error(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setTimeout(() => setTestStatus("idle"), 3000);
    }
  };

  const validateForm = () => {
    const errors: string[] = [];

    if (!formData.name.trim()) {
      errors.push("Connection name is required");
    }

    if (formData.type === "sqlite") {
      if (!formData.filePath.trim()) {
        errors.push("Database file path is required");
      }
    } else {
      if (!formData.host.trim()) {
        errors.push("Host is required");
      }
      if (!formData.database.trim()) {
        errors.push("Database name is required");
      }
      if (!formData.username.trim()) {
        errors.push("Username is required");
      }
      if (!formData.password.trim()) {
        errors.push("Password is required");
      }
    }

    return errors;
  };

  const handleSave = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      toast.error(errors[0]); // Show first error
      return;
    }

    setIsLoading(true);

    const workspaceId = selectedWorkspaceId || "uncategorized";

    if (editingConnectionId) {
      // Update existing connection
      const connectionConfig = {
        id: editingConnectionId,
        name: formData.name,
        type: formData.type,
        host: formData.host,
        port: formData.port,
        database: formData.database,
        username: formData.username,
        password: formData.password,
        ssl: formData.ssl,
        filePath: formData.filePath,
        workspaceId,
      };

      await updateConnection(editingConnectionId, connectionConfig);
      
      // Move connection to different workspace if needed
      const existingConnection = connections.get(editingConnectionId);
      if (existingConnection && existingConnection.config.workspaceId !== workspaceId) {
        // Remove from old workspace and add to new one
        if (existingConnection.config.workspaceId) {
          const { removeConnectionFromWorkspace } = useWorkspaceStore.getState();
          removeConnectionFromWorkspace(existingConnection.config.workspaceId, editingConnectionId);
        }
        addConnectionToWorkspace(workspaceId, editingConnectionId);
      }
    } else {
      // Add new connection
      const connectionId = crypto.randomUUID();
      const connectionConfig = {
        id: connectionId,
        name: formData.name,
        type: formData.type,
        host: formData.host,
        port: formData.port,
        database: formData.database,
        username: formData.username,
        password: formData.password,
        ssl: formData.ssl,
        filePath: formData.filePath,
        workspaceId,
      };

      await addConnection(connectionConfig);
      addConnectionToWorkspace(workspaceId, connectionId);

      // Auto-connect after adding
      await connect(connectionId);
    }

    setIsLoading(false);
    onOpenChange(false);

    // Reset form
    setFormData({
      name: "",
      type: "postgresql",
      host: "localhost",
      port: 5432,
      database: "",
      username: "",
      password: "",
      ssl: false,
      filePath: "",
    });
    setTestStatus("idle");
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "postgresql":
      case "mysql":
        return <Server className="h-4 w-4" />;
      case "sqlite":
        return <FileText className="h-4 w-4" />;
      case "mongodb":
        return <Database className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <Popover open={workspacePopoverOpen} onOpenChange={setWorkspacePopoverOpen}>
            <PopoverTrigger asChild>
              <DialogTitle className="cursor-pointer hover:bg-accent/50 rounded-md p-1 -m-1 flex items-center gap-1">
                {editingConnectionId ? "Edit connection in" : "New connection in"} {workspaces.get(selectedWorkspaceId)?.name || "Uncategorized"}
                <ChevronDown className="h-4 w-4 ml-1 opacity-50" />
              </DialogTitle>
            </PopoverTrigger>
            <PopoverContent className="p-1 w-48" side="bottom" align="start">
              <Command>
                <CommandList>
                  <CommandGroup>
                    {Array.from(workspaces.values()).map((workspace) => (
                      <CommandItem
                        key={workspace.id}
                        value={workspace.name}
                        onSelect={() => {
                          setSelectedWorkspaceId(workspace.id);
                          setWorkspacePopoverOpen(false);
                        }}
                        className="px-2 py-1.5"
                      >
                        {workspace.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </DialogHeader>

        <div className="grid gap-3 py-3">
          {/* Connection Name and Database Type on same row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1 col-span-2">
              <Label htmlFor="name" className="text-sm">
                Connection Name
              </Label>
              <Input
                id="name"
                placeholder="My Database"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                className="w-full"
              />
            </div>

            <div className="grid gap-1">
              <Label htmlFor="type" className="text-sm">
                Database Type
              </Label>
              <Select value={formData.type} onValueChange={handleTypeChange}>
                <SelectTrigger id="type" className="w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                    <div className="flex-shrink-0">{getIcon(formData.type)}</div>
                    <span className="truncate min-w-0">
                      {formData.type === 'postgresql' && 'PostgreSQL'}
                      {formData.type === 'mysql' && 'MySQL'}
                      {formData.type === 'sqlite' && 'SQLite'}
                      {formData.type === 'mongodb' && 'MongoDB'}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postgresql">
                    <div className="flex items-center gap-2">
                      {getIcon("postgresql")}
                      PostgreSQL
                    </div>
                  </SelectItem>
                  <SelectItem value="mysql">
                    <div className="flex items-center gap-2">
                      {getIcon("mysql")}
                      MySQL
                    </div>
                  </SelectItem>
                  <SelectItem value="sqlite">
                    <div className="flex items-center gap-2">
                      {getIcon("sqlite")}
                      SQLite
                    </div>
                  </SelectItem>
                  <SelectItem value="mongodb">
                    <div className="flex items-center gap-2">
                      {getIcon("mongodb")}
                      MongoDB
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {formData.type === "sqlite" ? (
            <div className="grid gap-1">
              <Label htmlFor="filePath" className="text-sm">
                Database File
              </Label>
              <Input
                id="filePath"
                placeholder="/path/to/database.db"
                value={formData.filePath}
                onChange={(e) => handleInputChange("filePath", e.target.value)}
              />
            </div>
          ) : (
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic">Basic</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="host" className="text-sm">
                      Host
                    </Label>
                    <Input
                      id="host"
                      value={formData.host}
                      onChange={(e) =>
                        handleInputChange("host", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="port" className="text-sm">
                      Port
                    </Label>
                    <Input
                      id="port"
                      type="number"
                      value={formData.port}
                      onChange={(e) =>
                        handleInputChange("port", parseInt(e.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="username" className="text-sm">
                      Username
                    </Label>
                    <Input
                      id="username"
                      value={formData.username}
                      onChange={(e) =>
                        handleInputChange("username", e.target.value)
                      }
                    />
                  </div>

                  <div className="grid gap-1">
                    <Label htmlFor="password" className="text-sm">
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) =>
                        handleInputChange("password", e.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="database" className="text-sm">
                    Database
                  </Label>
                  <Input
                    id="database"
                    placeholder={
                      formData.type === "mongodb" ? "mydb" : "database_name"
                    }
                    value={formData.database}
                    onChange={(e) =>
                      handleInputChange("database", e.target.value)
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-3 mt-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="ssl"
                    checked={formData.ssl}
                    onChange={(e) => handleInputChange("ssl", e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="ssl" className="text-sm">
                    Use SSL
                  </Label>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter className="gap-2">
          <div className="flex w-full justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={checkClipboard}
              disabled={testStatus === "testing"}
              className="h-8"
            >
              <Clipboard className="mr-1.5 h-3.5 w-3.5" />
              Paste URI
            </Button>
            <div className="flex gap-2">
              <Button
                variant={testStatus === "success" ? "default" : "outline"}
                size="sm"
                onClick={handleTestConnection}
                disabled={testStatus === "testing"}
                className={`h-8 ${
                  testStatus === "success"
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : ""
                }`}
              >
                {testStatus === "testing" ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Testing...
                  </>
                ) : testStatus === "success" ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Success
                  </>
                ) : (
                  "Test"
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isLoading || testStatus === "testing" || validateForm().length > 0}
                className="h-8"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  editingConnectionId ? "Save Changes" : "Save & Connect"
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}