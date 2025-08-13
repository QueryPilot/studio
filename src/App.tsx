import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Database, Moon, Sun, FileText } from "lucide-react";
import { Github } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { TitleBar } from "@/components/TitleBar";

function App() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TitleBar />
      
      {/* Main Content Container with padding for titlebar */}
      <div className="flex-1 flex flex-col overflow-auto pt-10">
        {/* Header */}
        <header className="flex-shrink-0 border-b bg-background">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
              <Button variant="ghost" size="icon">
                <Github className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="container mx-auto p-6">
            <div className="grid gap-6">
              {/* Welcome Card */}
              <Card className="p-8 text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                  <Database className="h-10 w-10 text-primary" />
                </div>
                <h2 className="mb-2 text-3xl font-bold">
                  Welcome to DevDB Studio
                </h2>
                <p className="mb-6 text-muted-foreground">
                  Your powerful database IDE for modern development
                </p>
                <div className="flex justify-center gap-4">
                  <Button size="lg">Get Started</Button>
                  <Button size="lg" variant="outline">
                    <FileText className="mr-2 h-4 w-4" />
                    Documentation
                  </Button>
                </div>
              </Card>

              {/* Feature Tabs */}
              <Card>
                <Tabs defaultValue="features" className="p-6">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="features">Features</TabsTrigger>
                    <TabsTrigger value="quickstart">Quick Start</TabsTrigger>
                    <TabsTrigger value="about">About</TabsTrigger>
                  </TabsList>

                  <TabsContent value="features" className="mt-6 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">
                          🚀 Fast & Lightweight
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Built with Tauri for native performance
                        </p>
                      </Card>
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">🎨 Beautiful UI</h3>
                        <p className="text-sm text-muted-foreground">
                          Modern interface with light and dark themes
                        </p>
                      </Card>
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">🔒 Secure</h3>
                        <p className="text-sm text-muted-foreground">
                          Your data stays on your machine
                        </p>
                      </Card>
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">
                          📊 Multi-Database
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Support for PostgreSQL, MySQL, SQLite, and more
                        </p>
                      </Card>
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">⚡ Query Editor</h3>
                        <p className="text-sm text-muted-foreground">
                          Intelligent autocomplete and syntax highlighting
                        </p>
                      </Card>
                      <Card className="p-4">
                        <h3 className="mb-2 font-semibold">
                          📈 Visualizations
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Beautiful charts and data insights
                        </p>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="quickstart" className="mt-6 space-y-4">
                    <div className="space-y-4">
                      <div>
                        <h3 className="mb-2 text-lg font-semibold">
                          1. Connect Your Database
                        </h3>
                        <p className="text-muted-foreground">
                          Click the "+" button to add a new database connection
                        </p>
                      </div>
                      <div>
                        <h3 className="mb-2 text-lg font-semibold">
                          2. Explore Your Schema
                        </h3>
                        <p className="text-muted-foreground">
                          Browse tables, views, and relationships in the sidebar
                        </p>
                      </div>
                      <div>
                        <h3 className="mb-2 text-lg font-semibold">
                          3. Run Queries
                        </h3>
                        <p className="text-muted-foreground">
                          Write and execute SQL queries with intelligent
                          autocomplete
                        </p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="about" className="mt-6">
                    <div className="space-y-4">
                      <p className="text-muted-foreground">
                        DevDB Studio is a modern database IDE built with
                        developers in mind. It combines the power of native
                        desktop applications with a beautiful, intuitive
                        interface.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge>React</Badge>
                        <Badge>TypeScript</Badge>
                        <Badge>Tauri</Badge>
                        <Badge>Rust</Badge>
                        <Badge>Tailwind CSS</Badge>
                        <Badge>shadcn/ui</Badge>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
