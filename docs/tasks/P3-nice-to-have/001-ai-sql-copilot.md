# P3-001: AI SQL Copilot Integration

## Priority
P3 - Nice-to-have

## Dependencies
- P2-005: Query History (for context-aware suggestions)
- P1-003: Column Metadata (for schema-aware completions)

## Estimated Effort
8-10 hours

## Problem Statement
Users struggle to write complex SQL queries, especially JOINs and aggregations. No intelligent assistance for query optimization or natural language to SQL conversion.

## Acceptance Criteria
- [ ] Natural language to SQL conversion
- [ ] Query explanation in plain English
- [ ] Optimization suggestions for slow queries  
- [ ] Schema-aware auto-completions
- [ ] Support multiple AI providers (OpenAI, Anthropic, Ollama)
- [ ] BYOK (Bring Your Own Key) model
- [ ] Local-first with Ollama support
- [ ] Query validation before execution

## Implementation Notes

### AI Service Architecture
```rust
// src-tauri/src/ai/mod.rs
use async_trait::async_trait;

#[async_trait]
pub trait AIProvider: Send + Sync {
    async fn complete(
        &self,
        prompt: String,
        context: QueryContext,
    ) -> Result<AIResponse, AIError>;
    
    async fn explain(
        &self,
        sql: String,
        schema: SchemaContext,
    ) -> Result<String, AIError>;
    
    async fn optimize(
        &self,
        sql: String,
        plan: QueryPlan,
    ) -> Result<OptimizationSuggestion, AIError>;
}

pub struct QueryContext {
    pub schema: Vec<TableSchema>,
    pub recent_queries: Vec<String>,
    pub current_table: Option<String>,
    pub available_functions: Vec<String>,
}

pub struct AIResponse {
    pub sql: String,
    pub explanation: String,
    pub confidence: f32,
    pub alternatives: Vec<String>,
}

// OpenAI Provider
pub struct OpenAIProvider {
    api_key: String,
    model: String,  // gpt-4, gpt-3.5-turbo
    temperature: f32,
}

impl OpenAIProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "gpt-4".to_string(),
            temperature: 0.1,  // Low for accuracy
        }
    }
}

#[async_trait]
impl AIProvider for OpenAIProvider {
    async fn complete(
        &self,
        prompt: String,
        context: QueryContext,
    ) -> Result<AIResponse, AIError> {
        let system_prompt = self.build_system_prompt(&context);
        
        let request = CreateCompletionRequest {
            model: self.model.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                Message {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
            temperature: self.temperature,
            max_tokens: 500,
        };
        
        let response = self.client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await?;
        
        let completion: CompletionResponse = response.json().await?;
        
        // Parse SQL from response
        let sql = self.extract_sql(&completion.choices[0].message.content)?;
        
        // Validate SQL syntax
        let validated = self.validate_sql(&sql, &context)?;
        
        Ok(AIResponse {
            sql: validated,
            explanation: self.generate_explanation(&sql, &context),
            confidence: self.calculate_confidence(&sql, &context),
            alternatives: vec![],
        })
    }
    
    fn build_system_prompt(&self, context: &QueryContext) -> String {
        format!(r#"
You are a SQL expert assistant. Generate SQL queries based on the user's natural language request.

Database Schema:
{}

Available Tables and Columns:
{}

Rules:
1. Generate valid SQL that works with the given schema
2. Use proper JOIN conditions based on foreign keys
3. Include appropriate WHERE clauses for filtering
4. Use meaningful column aliases
5. Prefer explicit column names over SELECT *
6. Add LIMIT for potentially large results
7. Return ONLY the SQL query, no explanations

Recent queries for context:
{}
"#, 
            self.format_schema(&context.schema),
            self.format_tables(&context.schema),
            context.recent_queries.join("\n")
        )
    }
}

// Ollama Provider for local AI
pub struct OllamaProvider {
    endpoint: String,
    model: String,  // codellama, sqlcoder, etc.
}

impl OllamaProvider {
    pub fn new() -> Self {
        Self {
            endpoint: "http://localhost:11434".to_string(),
            model: "sqlcoder:latest".to_string(),
        }
    }
}

#[async_trait]
impl AIProvider for OllamaProvider {
    async fn complete(
        &self,
        prompt: String,
        context: QueryContext,
    ) -> Result<AIResponse, AIError> {
        let request = OllamaRequest {
            model: self.model.clone(),
            prompt: format!("{}\n\n{}", 
                self.build_context(&context),
                prompt
            ),
            stream: false,
            options: OllamaOptions {
                temperature: 0.1,
                top_p: 0.9,
                num_predict: 500,
            },
        };
        
        let response = reqwest::Client::new()
            .post(&format!("{}/api/generate", self.endpoint))
            .json(&request)
            .send()
            .await?;
        
        let result: OllamaResponse = response.json().await?;
        
        Ok(AIResponse {
            sql: self.extract_sql(&result.response)?,
            explanation: "Generated locally with Ollama".to_string(),
            confidence: 0.8,
            alternatives: vec![],
        })
    }
}

// AI Service Manager
pub struct AIService {
    providers: HashMap<String, Box<dyn AIProvider>>,
    active_provider: String,
}

impl AIService {
    pub fn new() -> Self {
        let mut providers: HashMap<String, Box<dyn AIProvider>> = HashMap::new();
        
        // Check for available providers
        if let Ok(api_key) = env::var("OPENAI_API_KEY") {
            providers.insert(
                "openai".to_string(),
                Box::new(OpenAIProvider::new(api_key))
            );
        }
        
        if let Ok(api_key) = env::var("ANTHROPIC_API_KEY") {
            providers.insert(
                "anthropic".to_string(),
                Box::new(AnthropicProvider::new(api_key))
            );
        }
        
        // Always try to add Ollama (local)
        providers.insert(
            "ollama".to_string(),
            Box::new(OllamaProvider::new())
        );
        
        Self {
            active_provider: "ollama".to_string(),
            providers,
        }
    }
    
    pub async fn natural_language_to_sql(
        &self,
        prompt: String,
        connection_id: String,
    ) -> Result<AIResponse, AIError> {
        let context = self.build_context(connection_id).await?;
        
        let provider = self.providers
            .get(&self.active_provider)
            .ok_or(AIError::ProviderNotFound)?;
        
        provider.complete(prompt, context).await
    }
}
```

### Frontend AI Assistant UI
```typescript
// src/components/AICopilot/AICopilot.tsx
export function AICopilot({ 
  connectionId,
  onInsertSQL,
}: AICopilotProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [provider, setProvider] = useState('ollama');
  
  const generateSQL = async () => {
    setLoading(true);
    
    try {
      const response = await invoke('ai_natural_to_sql', {
        prompt,
        connectionId,
        provider,
      });
      
      setSuggestions([response, ...suggestions]);
    } catch (error) {
      toast.error(`AI generation failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };
  
  const explainSQL = async (sql: string) => {
    const explanation = await invoke('ai_explain_sql', {
      sql,
      connectionId,
    });
    
    return explanation;
  };
  
  return (
    <div className="ai-copilot p-4 border rounded">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">AI SQL Assistant</h3>
        
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="w-32 ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">Local (Ollama)</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-4">
        {/* Natural language input */}
        <div>
          <Label>Describe what you want in plain English:</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Show me the top 10 customers by total order value in the last 30 days"
            rows={3}
          />
        </div>
        
        <Button
          onClick={generateSQL}
          disabled={loading || !prompt}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate SQL
            </>
          )}
        </Button>
        
        {/* Suggestions list */}
        <div className="space-y-2">
          {suggestions.map((suggestion, i) => (
            <SuggestionCard
              key={i}
              suggestion={suggestion}
              onUse={() => onInsertSQL(suggestion.sql)}
              onExplain={() => explainSQL(suggestion.sql)}
            />
          ))}
        </div>
      </div>
      
      {/* Quick actions */}
      <div className="mt-4 pt-4 border-t">
        <Label>Quick Actions:</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrompt('Find duplicate rows')}
          >
            Find Duplicates
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrompt('Show table relationships')}
          >
            Show Relations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrompt('Analyze data distribution')}
          >
            Data Distribution
          </Button>
        </div>
      </div>
    </div>
  );
}

// Suggestion card component
function SuggestionCard({ 
  suggestion, 
  onUse, 
  onExplain 
}: SuggestionCardProps) {
  const [showExplanation, setShowExplanation] = useState(false);
  
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <pre className="text-sm bg-muted p-2 rounded overflow-x-auto">
              {suggestion.sql}
            </pre>
            
            {suggestion.confidence < 0.7 && (
              <Alert className="mt-2">
                <AlertDescription>
                  Low confidence. Please review before executing.
                </AlertDescription>
              </Alert>
            )}
            
            {showExplanation && (
              <div className="mt-2 text-sm text-muted-foreground">
                {suggestion.explanation}
              </div>
            )}
          </div>
          
          <div className="flex gap-1 ml-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowExplanation(!showExplanation)}
            >
              <Info className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onUse}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

## Files to Modify
- Create `src-tauri/src/ai/mod.rs` - AI service core
- Create `src-tauri/src/ai/providers/` - Provider implementations
- Create `src-tauri/src/ai/validation.rs` - SQL validation
- Update `src-tauri/src/commands/ai.rs` - AI commands
- Create `src/components/AICopilot/` - AI UI components
- Update `src/components/QueryEditor.tsx` - Integrate AI assistant
- Add AI provider settings to preferences

## Testing Requirements
1. **Unit Tests**
   - Test prompt building
   - Test SQL extraction from responses
   - Test validation logic

2. **Integration Tests**
   - Test with each provider
   - Test natural language examples
   - Test error handling

3. **Manual Testing**
   - Test various query types
   - Verify schema awareness
   - Test with bad prompts

## Success Metrics
- 80%+ accuracy for common queries
- Response time < 3 seconds
- Works offline with Ollama
- No sensitive data sent to cloud

## Notes
- Must sanitize schema before sending to AI
- Consider caching common patterns
- Future: Fine-tune model on user's queries