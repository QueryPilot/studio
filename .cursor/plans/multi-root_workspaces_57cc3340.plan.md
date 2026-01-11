---
name: Named Multi-Root Workspaces
overview: Implement named workspaces that bundle multiple database connections, persistable to vault or .qpworkspace files, allowing users to save and restore their working context.
todos:
  - id: phase1-types
    content: Define Workspace, WorkspaceConfig, OpenConnection, ActiveWorkspace types
    status: completed
  - id: phase1-store
    content: Create workspaceBundleStore.ts with full state management
    status: completed
  - id: phase1-vault
    content: Extend vaultStorage to support workspace CRUD operations
    status: completed
  - id: phase1-edge-remove
    content: Implement removeConnectionFromWorkspace with tab close prompt
    status: completed
  - id: phase1-edge-add
    content: Implement addConnectionToWorkspace with auto-connect/focus
    status: completed
  - id: phase1-edge-missing
    content: Handle missing connection profiles on workspace open
    status: completed
  - id: phase1-edge-failure
    content: Handle connection failures (continue partial, error badge)
    status: completed
  - id: phase2-file-io
    content: Implement .qpworkspace file import/export service
    status: completed
  - id: phase3-routing
    content: Update routing to /workspace/:workspaceId with backwards compat
    status: completed
  - id: phase4-activitybar
    content: Build ConnectionActivityBar with drag-reorder, status, context menu
    status: completed
  - id: phase4-dirty
    content: Implement dirty state tracking and window title indicator
    status: completed
  - id: phase5-sidebar-workspaces
    content: Create SidebarWorkspaces component in ActionBar
    status: completed
  - id: phase5-workspace-filter
    content: Create WorkspaceFilter component (filter connections by workspace)
    status: completed
  - id: phase5-workspaces-section
    content: Create WorkspacesSection for main content area
    status: completed
  - id: phase5-workspace-form
    content: Create WorkspaceForm for create/edit workspace
    status: completed
  - id: phase5-workspace-detail
    content: Create WorkspaceDetailView for viewing/managing single workspace
    status: completed
  - id: phase5-homestore
    content: Update homeScreenStore with workspace state and actions
    status: completed
  - id: phase5-picker
    content: Create minimal WorkspacePicker for /workspace route
    status: completed
  - id: phase5-multiwindow
    content: Implement multi-window prevention (focus existing)
    status: completed
  - id: phase6-hooks
    content: Refactor hooks to work with multi-connection context
    status: completed
  - id: phase7-sync
    content: Implement tab-sidebar bidirectional sync
    status: completed
  - id: phase8-save
    content: Implement workspace save with full tab layout persistence
    status: completed
---
