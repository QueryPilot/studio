/**
 * Example usage of ErrorBoundary components
 *
 * This file shows how to use both the main ErrorBoundary
 * and the FeatureErrorBoundary for isolated error handling
 */

import { FeatureErrorBoundary } from './FeatureErrorBoundary';
import { QueryPanel } from './QueryPanel/QueryPanel';

// Example 1: Wrap individual features to isolate errors
export function WorkbenchPanelExample() {
  return (
    <FeatureErrorBoundary
      featureName="Query Panel"
      onReset={() => {
        console.log('Query panel error boundary reset');
      }}
    >
      <QueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="mydb"
      />
    </FeatureErrorBoundary>
  );
}

// Example 2: Wrap data grids
export function DataGridExample() {
  return (
    <FeatureErrorBoundary
      featureName="Data Grid"
      onReset={() => {
        console.log('Data grid error boundary reset');
      }}
    >
      {/* Your data grid component */}
      <div>Data Grid Content</div>
    </FeatureErrorBoundary>
  );
}

// Example 3: Wrap AI assistant
export function AIAssistantExample() {
  return (
    <FeatureErrorBoundary
      featureName="AI Assistant"
      onReset={() => {
        console.log('AI assistant error boundary reset');
      }}
    >
      {/* Your AI assistant component */}
      <div>AI Assistant Content</div>
    </FeatureErrorBoundary>
  );
}

/**
 * Best Practices:
 *
 * 1. Use the main ErrorBoundary at the app root (already done in main.tsx)
 * 2. Use FeatureErrorBoundary for major features/panels that could fail independently
 * 3. Provide descriptive featureName for better error messages
 * 4. Use onReset callback to clean up feature state before retry
 * 5. Don't wrap too granularly - wrap logical feature boundaries
 *
 * Where to add FeatureErrorBoundary:
 * - Around each workbench panel
 * - Around sidebars (database explorer, AI assistant)
 * - Around major data grids
 * - Around ERD visualizations
 * - Around query editors
 *
 * Where NOT to use:
 * - Around individual buttons/inputs (too granular)
 * - Around simple UI components (overhead not worth it)
 * - Inside loops (creates too many boundaries)
 */
