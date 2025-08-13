import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Database,
  Plus,
  Settings,
  ChevronRight,
  Clock,
  Server,
  HardDrive,
  Search,
  Folder,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { windowManager } from "@/services/windowManager";
import logo from "@/assets/logo.png";

interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
  databases: {
    type: "postgresql" | "mysql" | "sqlite" | "mongodb";
    name: string;
  }[];
}

const mockWorkspaces: Workspace[] = [
  {
    id: "1",
    name: "E-Commerce Platform",
    path: "~/Projects/ecommerce",
    lastOpened: "2 hours ago",
    databases: [
      { type: "postgresql", name: "ecommerce_prod" },
      { type: "postgresql", name: "ecommerce_dev" },
      { type: "sqlite", name: "cache.db" },
    ],
  },
  {
    id: "2",
    name: "Analytics Dashboard",
    path: "~/Projects/analytics",
    lastOpened: "Yesterday",
    databases: [
      { type: "mongodb", name: "analytics_main" },
      { type: "mysql", name: "reports_db" },
    ],
  },
  {
    id: "3",
    name: "Personal Blog",
    path: "~/Projects/blog",
    lastOpened: "3 days ago",
    databases: [{ type: "sqlite", name: "blog.db" }],
  },
  {
    id: "uncategorized",
    name: "Uncategorized",
    path: "~/",
    lastOpened: "Always",
    databases: [],
  },
];

function getDatabaseIcon(type: string) {
  switch (type) {
    case "postgresql":
      return <Database className="h-4 w-4 text-blue-500" />;
    case "mysql":
      return <Server className="h-4 w-4 text-orange-500" />;
    case "sqlite":
      return <HardDrive className="h-4 w-4 text-green-500" />;
    case "mongodb":
      return <Database className="h-4 w-4 text-emerald-500" />;
    default:
      return <Database className="h-4 w-4" />;
  }
}

export function MainScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredWorkspaces = mockWorkspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workspace.databases.some((db) =>
        db.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <div
        data-tauri-drag-region
        className="select-none h-5 w-full absolute top-0 left-0 cursor-grab z-50"
      ></div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - 1/3 width */}
        <div className="w-1/3 max-w-[380px] flex-shrink-0 bg-muted/30 flex flex-col select-none">
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
            {/* Logo */}
            <div className="mb-4">
              <img
                src={logo}
                alt="DevDB Studio"
                className="h-20 w-20 rounded-2xl"
              />
            </div>

            {/* Welcome Message */}
            <h1 className="text-2xl font-bold mb-3 text-center">
              DevDB Studio
            </h1>

            {/* Version Badge */}
            <Badge variant="secondary" className="mb-6">
              Version 0.1.0
            </Badge>

            {/* CTA Actions */}
            <div className="w-full space-y-2">
              <Button className="w-full justify-start" size="default">
                <Folder className="mr-2 h-4 w-4" />
                New Workspace
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start"
                size="default"
              >
                <Database className="mr-2 h-4 w-4" />
                Connect Database
              </Button>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="p-4 space-y-1">
            {/* <Button variant="ghost" className="w-full justify-start" size="sm">
              <BookOpen className="mr-2 h-4 w-4" />
              Documentation
            </Button>
            <Button variant="ghost" className="w-full justify-start" size="sm">
              <GitBranch className="mr-2 h-4 w-4" />
              GitHub
            </Button> */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                className="flex-1 justify-start"
                size="sm"
              >
                <Settings className="mr-2 h-4 w-4" />
                Preferences
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Header */}
          <div className="px-6 py-4 sticky top-0 z-10 bg-background/30 backdrop-blur-sm backdrop-filter">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search workspaces... (⌘F)"
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Workspaces List */}
          <div className="flex-1 overflow-auto">
            <div className="p-6 pt-2">
              <div className="space-y-3">
                {filteredWorkspaces.map((workspace) => (
                  <Card
                    key={workspace.id}
                    className="p-4 bg-muted/30 hover:bg-muted/70 transition-colors cursor-pointer group border-0 shadow-none hover:shadow-sm"
                    onClick={() => windowManager.openWorkspace(workspace.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-base font-semibold flex items-center">
                          {workspace.name}
                          <ChevronRight className="ml-2 h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {workspace.id !== "uncategorized" && (
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Clock className="mr-1 h-3 w-3" />
                            {workspace.lastOpened}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Databases */}
                    <div className="space-y-2">
                      {workspace.databases.map((db, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/90 hover:bg-muted transition-colors cursor-pointer group border-0 shadow-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            windowManager.openWorkspace(workspace.id);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {getDatabaseIcon(db.type)}
                            <span className="text-sm font-medium select-none">
                              {db.name}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-xs select-none"
                          >
                            {db.type}
                          </Badge>
                        </div>
                      ))}

                      {/* Add Database Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start mt-1 h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log(
                            `Add database to workspace: ${workspace.name}`,
                          );
                        }}
                      >
                        <Plus className="mr-2 h-3 w-3" />
                        Add Database
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Empty State */}
              {filteredWorkspaces.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[400px] text-center">
                  <Database className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No workspaces found
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {searchQuery
                      ? "Try adjusting your search terms"
                      : "Create your first workspace to get started"}
                  </p>
                  {!searchQuery && (
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Workspace
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
