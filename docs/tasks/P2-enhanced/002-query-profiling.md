# P2-002: Query Profiling and EXPLAIN Visualization

## Priority
P2 - Enhanced Feature

## Dependencies
- P0-004: Cursor Management (for executing EXPLAIN queries)

## Estimated Effort
4-5 hours

## Problem Statement
Users can't identify why queries are slow or which indexes are being used. No visibility into query execution plans or performance bottlenecks.

## Acceptance Criteria
- [ ] EXPLAIN plan execution for any query
- [ ] Visual tree representation of execution plan
- [ ] Cost breakdown and timing for each node
- [ ] Index usage highlighting
- [ ] Suggestions for missing indexes
- [ ] Historical query performance tracking
- [ ] Support for EXPLAIN ANALYZE (with actual timings)

## Implementation Notes

### Backend (Rust)
```rust
// src-tauri/src/profiling/mod.rs
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct QueryPlan {
    pub query: String,
    pub plan_tree: PlanNode,
    pub total_cost: f64,
    pub execution_time_ms: Option<f64>,
    pub planning_time_ms: Option<f64>,
    pub suggestions: Vec<OptimizationSuggestion>,
}

#[derive(Serialize, Deserialize)]
pub struct PlanNode {
    pub node_type: String,  // "Seq Scan", "Index Scan", "Nested Loop", etc.
    pub relation_name: Option<String>,
    pub index_name: Option<String>,
    pub startup_cost: f64,
    pub total_cost: f64,
    pub plan_rows: i64,
    pub plan_width: i32,
    pub actual_rows: Option<i64>,
    pub actual_time_start: Option<f64>,
    pub actual_time_end: Option<f64>,
    pub loops: Option<i32>,
    pub filter: Option<String>,
    pub join_type: Option<String>,
    pub children: Vec<PlanNode>,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OptimizationSuggestion {
    pub severity: SuggestionSeverity,
    pub message: String,
    pub affected_table: Option<String>,
    pub suggested_index: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub enum SuggestionSeverity {
    Critical,  // Major performance issue
    Warning,   // Suboptimal but acceptable
    Info,      // General recommendation
}

impl PostgresAdapter {
    pub async fn explain_query(
        &self,
        sql: &str,
        analyze: bool,
        buffers: bool,
        format: &str,
    ) -> Result<QueryPlan, AppError> {
        // Build EXPLAIN command
        let mut explain_opts = vec![];
        
        if analyze {
            explain_opts.push("ANALYZE");
        }
        if buffers {
            explain_opts.push("BUFFERS");
        }
        explain_opts.push(&format!("FORMAT {}", format));
        
        let explain_sql = format!(
            "EXPLAIN ({}) {}",
            explain_opts.join(", "),
            sql
        );
        
        // Execute EXPLAIN
        let row = sqlx::query(&explain_sql)
            .fetch_one(&**self.pool)
            .await
            .map_err(AppError::from_sqlx)?;
        
        // Parse JSON output
        let json_plan: serde_json::Value = row.get(0);
        let plan = self.parse_postgres_plan(json_plan)?;
        
        // Generate optimization suggestions
        let suggestions = self.analyze_plan_for_suggestions(&plan);
        
        Ok(QueryPlan {
            query: sql.to_string(),
            plan_tree: plan,
            total_cost: self.calculate_total_cost(&plan),
            execution_time_ms: self.extract_execution_time(&plan),
            planning_time_ms: None,  // Would need separate query
            suggestions,
        })
    }
    
    fn parse_postgres_plan(
        &self,
        json: serde_json::Value,
    ) -> Result<PlanNode, AppError> {
        // PostgreSQL specific plan parsing
        let plan_json = &json[0]["Plan"];
        
        Ok(PlanNode {
            node_type: plan_json["Node Type"].as_str()
                .unwrap_or("Unknown")
                .to_string(),
            relation_name: plan_json["Relation Name"].as_str()
                .map(String::from),
            index_name: plan_json["Index Name"].as_str()
                .map(String::from),
            startup_cost: plan_json["Startup Cost"].as_f64()
                .unwrap_or(0.0),
            total_cost: plan_json["Total Cost"].as_f64()
                .unwrap_or(0.0),
            plan_rows: plan_json["Plan Rows"].as_i64()
                .unwrap_or(0),
            plan_width: plan_json["Plan Width"].as_i64()
                .unwrap_or(0) as i32,
            actual_rows: plan_json["Actual Rows"].as_i64(),
            actual_time_start: plan_json["Actual Startup Time"].as_f64(),
            actual_time_end: plan_json["Actual Total Time"].as_f64(),
            loops: plan_json["Actual Loops"].as_i64()
                .map(|l| l as i32),
            filter: plan_json["Filter"].as_str()
                .map(String::from),
            join_type: plan_json["Join Type"].as_str()
                .map(String::from),
            children: self.parse_child_plans(&plan_json["Plans"])?,
            warnings: self.detect_plan_warnings(&plan_json),
        })
    }
    
    fn analyze_plan_for_suggestions(
        &self,
        plan: &PlanNode,
    ) -> Vec<OptimizationSuggestion> {
        let mut suggestions = vec![];
        
        // Check for sequential scans on large tables
        if plan.node_type == "Seq Scan" {
            if let Some(rows) = plan.actual_rows {
                if rows > 10000 {
                    suggestions.push(OptimizationSuggestion {
                        severity: SuggestionSeverity::Critical,
                        message: format!(
                            "Sequential scan on {} with {} rows. Consider adding an index.",
                            plan.relation_name.as_ref().unwrap_or(&"table".to_string()),
                            rows
                        ),
                        affected_table: plan.relation_name.clone(),
                        suggested_index: Some(self.suggest_index_from_filter(&plan.filter)),
                    });
                }
            }
        }
        
        // Check for missing join indexes
        if plan.node_type == "Nested Loop" {
            if let Some(cost) = plan.actual_time_end {
                if cost > 1000.0 {  // More than 1 second
                    suggestions.push(OptimizationSuggestion {
                        severity: SuggestionSeverity::Warning,
                        message: "Slow nested loop join. Consider adding indexes on join columns.".to_string(),
                        affected_table: None,
                        suggested_index: None,
                    });
                }
            }
        }
        
        // Check for poor row estimates
        if let (Some(estimated), Some(actual)) = (Some(plan.plan_rows), plan.actual_rows) {
            let ratio = (actual as f64) / (estimated as f64);
            if ratio > 10.0 || ratio < 0.1 {
                suggestions.push(OptimizationSuggestion {
                    severity: SuggestionSeverity::Info,
                    message: format!(
                        "Poor row estimate: expected {}, got {}. Consider updating statistics.",
                        estimated, actual
                    ),
                    affected_table: plan.relation_name.clone(),
                    suggested_index: None,
                });
            }
        }
        
        // Recursively check children
        for child in &plan.children {
            suggestions.extend(self.analyze_plan_for_suggestions(child));
        }
        
        suggestions
    }
}

// Query performance history
#[derive(Serialize, Deserialize)]
pub struct QueryPerformanceHistory {
    pub query_hash: String,
    pub executions: Vec<QueryExecution>,
}

#[derive(Serialize, Deserialize)]
pub struct QueryExecution {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub execution_time_ms: f64,
    pub rows_returned: i64,
    pub plan_hash: String,
}
```

### Frontend Visualization (React/TypeScript)
```typescript
// src/components/QueryProfiler/PlanVisualizer.tsx
import { useRef, useEffect } from 'react';
import * from 'd3';

interface PlanVisualizerProps {
  plan: QueryPlan;
  onNodeClick?: (node: PlanNode) => void;
}

export function PlanVisualizer({ plan, onNodeClick }: PlanVisualizerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  
  useEffect(() => {
    if (!svgRef.current || !plan) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    
    const width = 800;
    const height = 600;
    const margin = { top: 20, right: 90, bottom: 30, left: 90 };
    
    // Create tree layout
    const treeLayout = d3.tree()
      .size([height - margin.top - margin.bottom, width - margin.left - margin.right]);
    
    // Convert plan to hierarchy
    const root = d3.hierarchy(plan.plan_tree, d => d.children);
    const treeData = treeLayout(root);
    
    // Create main group
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Draw links
    g.selectAll(".link")
      .data(treeData.links())
      .enter().append("path")
      .attr("class", "link")
      .attr("d", d3.linkHorizontal()
        .x(d => d.y)
        .y(d => d.x))
      .style("fill", "none")
      .style("stroke", "#ccc")
      .style("stroke-width", 2);
    
    // Draw nodes
    const nodes = g.selectAll(".node")
      .data(treeData.descendants())
      .enter().append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.y},${d.x})`)
      .on("click", (event, d) => onNodeClick?.(d.data));
    
    // Node circles with color based on cost
    nodes.append("circle")
      .attr("r", 8)
      .style("fill", d => {
        const cost = d.data.total_cost;
        if (cost > 1000) return "#ef4444";  // Red for high cost
        if (cost > 100) return "#f59e0b";   // Orange for medium
        return "#10b981";                    // Green for low
      })
      .style("stroke", "#000")
      .style("stroke-width", 1.5);
    
    // Node labels
    nodes.append("text")
      .attr("dy", ".35em")
      .attr("x", d => d.children ? -13 : 13)
      .style("text-anchor", d => d.children ? "end" : "start")
      .text(d => {
        const node = d.data;
        let label = node.node_type;
        if (node.relation_name) {
          label += ` (${node.relation_name})`;
        }
        if (node.index_name) {
          label += ` [${node.index_name}]`;
        }
        return label;
      })
      .style("font-size", "12px");
    
    // Cost labels
    nodes.append("text")
      .attr("dy", "1.5em")
      .attr("x", d => d.children ? -13 : 13)
      .style("text-anchor", d => d.children ? "end" : "start")
      .text(d => `Cost: ${d.data.total_cost.toFixed(2)}`)
      .style("font-size", "10px")
      .style("fill", "#666");
    
    // Actual time labels (if available)
    nodes.filter(d => d.data.actual_time_end)
      .append("text")
      .attr("dy", "2.5em")
      .attr("x", d => d.children ? -13 : 13)
      .style("text-anchor", d => d.children ? "end" : "start")
      .text(d => `Time: ${d.data.actual_time_end.toFixed(2)}ms`)
      .style("font-size", "10px")
      .style("fill", "#666");
    
  }, [plan, onNodeClick]);
  
  return (
    <div className="plan-visualizer">
      <svg ref={svgRef} width="100%" height="600" />
    </div>
  );
}

// src/components/QueryProfiler/SuggestionsList.tsx
export function SuggestionsList({ 
  suggestions 
}: { 
  suggestions: OptimizationSuggestion[] 
}) {
  const grouped = suggestions.reduce((acc, suggestion) => {
    if (!acc[suggestion.severity]) {
      acc[suggestion.severity] = [];
    }
    acc[suggestion.severity].push(suggestion);
    return acc;
  }, {} as Record<string, OptimizationSuggestion[]>);
  
  return (
    <div className="space-y-4">
      {grouped.Critical && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Critical Performance Issues</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 mt-2">
              {grouped.Critical.map((s, i) => (
                <li key={i}>
                  {s.message}
                  {s.suggested_index && (
                    <div className="mt-1">
                      <code className="text-xs bg-muted p-1 rounded">
                        CREATE INDEX ON {s.affected_table} ({s.suggested_index})
                      </code>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {grouped.Warning && (
        <Alert>
          <AlertTitle>Performance Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 mt-2">
              {grouped.Warning.map((s, i) => (
                <li key={i}>{s.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {grouped.Info && (
        <div className="text-sm text-muted-foreground">
          <h4 className="font-medium mb-2">Recommendations</h4>
          <ul className="list-disc pl-4">
            {grouped.Info.map((s, i) => (
              <li key={i}>{s.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Main profiler component
export function QueryProfiler({ sql, connectionId }: QueryProfilerProps) {
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState(false);
  
  const runExplain = async () => {
    setLoading(true);
    try {
      const result = await invoke('db_explain_query', {
        connectionId,
        sql,
        analyze: analyzeMode,
        buffers: true,
        format: 'JSON',
      });
      setPlan(result);
    } catch (error) {
      toast.error(`Failed to explain query: ${error}`);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="query-profiler">
      <div className="flex items-center gap-4 mb-4">
        <Button onClick={runExplain} disabled={loading}>
          {loading ? 'Analyzing...' : 'Explain Query'}
        </Button>
        
        <div className="flex items-center gap-2">
          <Switch
            checked={analyzeMode}
            onCheckedChange={setAnalyzeMode}
          />
          <Label>Run with ANALYZE (executes query)</Label>
        </div>
      </div>
      
      {plan && (
        <Tabs defaultValue="visual">
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
            <TabsTrigger value="raw">Raw Plan</TabsTrigger>
          </TabsList>
          
          <TabsContent value="visual">
            <PlanVisualizer plan={plan} />
          </TabsContent>
          
          <TabsContent value="suggestions">
            <SuggestionsList suggestions={plan.suggestions} />
          </TabsContent>
          
          <TabsContent value="raw">
            <pre className="text-xs overflow-auto p-4 bg-muted rounded">
              {JSON.stringify(plan, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
```

## Files to Modify
- Create `src-tauri/src/profiling/mod.rs` - Profiling core logic
- Create `src-tauri/src/profiling/postgres.rs` - PostgreSQL specific
- Create `src-tauri/src/profiling/mysql.rs` - MySQL specific
- Update `src-tauri/src/commands/database.rs` - Add explain command
- Create `src/components/QueryProfiler/` - Profiler UI components
- Install d3.js for visualization: `pnpm add d3 @types/d3`

## Testing Requirements
1. **Unit Tests**
   - Test plan parsing for each database
   - Test suggestion generation logic
   - Test cost calculations

2. **Integration Tests**
   - Run EXPLAIN on complex queries
   - Verify visualization renders correctly
   - Test with different plan shapes

3. **Manual Testing**
   - Profile slow queries
   - Verify suggestions are actionable
   - Test ANALYZE mode impact

## Success Metrics
- EXPLAIN execution < 100ms
- Suggestions identify real issues
- Visualization handles 50+ nodes
- History tracks last 100 queries

## Notes
- Consider caching EXPLAIN results
- May need database-specific parsers
- Future: Compare plans before/after optimization