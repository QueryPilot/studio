import { Badge } from "@/components/ui/badge";
import { Clock, Database, Rows } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

export function StatusBar() {
  const [currentDatabase, setCurrentDatabase] = useState("ecommerce_prod");
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("connected");

  return (
    <div className="h-8 border-t bg-muted/50 flex items-center justify-between px-4 text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "connecting"
                ? "bg-yellow-500 animate-pulse"
                : "bg-red-500"
            }`}
          />
          <span className="text-muted-foreground">
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "connecting"
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground" />
          <Select value={currentDatabase} onValueChange={setCurrentDatabase}>
            <SelectTrigger className="h-5 text-xs border-0 bg-transparent hover:bg-muted px-1 py-0 gap-1">
              <SelectValue placeholder="Select database" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ecommerce_prod">ecommerce_prod</SelectItem>
              <SelectItem value="ecommerce_dev">ecommerce_dev</SelectItem>
              <SelectItem value="cache_db">cache.db</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Query: 0.234s</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Rows className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Rows: 1,234</span>
        </div>

        <Badge variant="outline" className="h-5 text-[10px]">
          PostgreSQL 15.2
        </Badge>
      </div>
    </div>
  );
}
