import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Sparkles, Code, Lightbulb, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AISidebarProps {
  connectionId: string;
}

export function AISidebar({ connectionId: _connectionId }: AISidebarProps) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

  const handleSend = () => {
    if (message.trim()) {
      setMessages([...messages, { role: "user", content: message }]);
      // TODO: Send to AI service
      setMessage("");
      
      // Mock AI response
      setTimeout(() => {
        setMessages(prev => [...prev, { 
          role: "assistant", 
          content: "I can help you with SQL queries and database operations. What would you like to know?" 
        }]);
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h3 className="font-semibold flex items-center gap-1.5 text-sm">
          <Sparkles className="h-4 w-4" />
          AI Assistant
        </h3>
      </div>

      <Tabs defaultValue="chat" className="flex-1 flex flex-col">
        <TabsList className="mx-2 mt-2 h-8">
          <TabsTrigger value="chat" className="text-sm h-7">Chat</TabsTrigger>
          <TabsTrigger value="suggest" className="text-sm h-7">Suggest</TabsTrigger>
          <TabsTrigger value="explain" className="text-sm h-7">Explain</TabsTrigger>
          <TabsTrigger value="optimize" className="text-sm h-7">Optimize</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 flex flex-col px-2 pb-2">
          <ScrollArea className="flex-1 pr-2">
            <div className="space-y-2 py-2">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Ask me anything about your database!</p>
                  <p className="text-xs mt-1">I can help with queries, optimization, and explanations.</p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg ${
                      msg.role === "user" 
                        ? "bg-primary/10 ml-2" 
                        : "bg-muted mr-2"
                    }`}
                  >
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          
          <div className="mt-2 space-y-1">
            <Textarea
              placeholder="Ask a question..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="min-h-[60px] text-sm"
            />
            <Button 
              onClick={handleSend} 
              className="w-full h-8 text-sm"
              disabled={!message.trim()}
            >
              <Send className="h-4 w-4 mr-1.5" />
              Send
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="suggest" className="flex-1 p-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Code className="h-5 w-5" />
              <span className="text-sm">SQL Suggestions</span>
            </div>
            <div className="space-y-2">
              <div className="p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80">
                <p className="text-sm font-medium">Select all users</p>
                <code className="text-sm text-muted-foreground">SELECT * FROM users</code>
              </div>
              <div className="p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80">
                <p className="text-sm font-medium">Count orders by status</p>
                <code className="text-sm text-muted-foreground">SELECT status, COUNT(*) FROM orders GROUP BY status</code>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="explain" className="flex-1 p-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Lightbulb className="h-5 w-5" />
              <span className="text-sm">Query Explanation</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Select a query or table to get detailed explanations about its structure and usage.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="optimize" className="flex-1 p-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-5 w-5" />
              <span className="text-sm">Performance Optimization</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Analyze your queries and get optimization suggestions to improve performance.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}