import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useErdStore } from '../erdStore';

describe('erdStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useErdStore.setState({
      views: {},
      connectionViewIds: {},
      activeViewId: null,
    });

    // Mock Date for consistent timestamps
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should start with empty state', () => {
      const state = useErdStore.getState();

      expect(state.views).toEqual({});
      expect(state.connectionViewIds).toEqual({});
      expect(state.activeViewId).toBe(null);
    });
  });

  describe('ensureView', () => {
    it('should create a new ERD view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
        name: 'Test ERD',
      });

      expect(viewId).toBeTruthy();

      const state = useErdStore.getState();
      expect(Object.keys(state.views)).toHaveLength(1);

      const view = state.views[viewId];
      expect(view.id).toBe(viewId);
      expect(view.name).toBe('Test ERD');
      expect(view.connectionId).toBe('conn-1');
      expect(view.database).toBe('testdb');
      expect(view.schema).toBe('public');
      expect(view.dbml).toBe('');
      expect(view.tableCount).toBe(0);
      expect(view.relationshipCount).toBe(0);
      expect(view.nodePositions).toEqual({});
      expect(view.layoutDirection).toBe('LR');
      expect(view.createdAt).toBe('2025-01-15T10:00:00.000Z');
      expect(view.updatedAt).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should auto-generate name if not provided', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        database: 'mydb',
        schema: 'public',
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.name).toBe('public @mydb');
    });

    it('should create temporary view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
        isTemporary: true,
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.isTemporary).toBe(true);
    });

    it('should return existing view if already exists', () => {
      const store = useErdStore.getState();

      const viewId1 = store.ensureView({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
      });

      const viewId2 = store.ensureView({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
      });

      expect(viewId1).toBe(viewId2);
      expect(Object.keys(useErdStore.getState().views)).toHaveLength(1);
    });

    it('should set active view to first view created', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      expect(useErdStore.getState().activeViewId).toBe(viewId);
    });

    it('should track views by connection', () => {
      const store = useErdStore.getState();

      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'auth' });

      const state = useErdStore.getState();
      const key = 'conn-1::db1';
      expect(state.connectionViewIds[key]).toHaveLength(2);
    });
  });

  describe('updateView', () => {
    it('should update view DBML content', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      vi.setSystemTime(new Date('2025-01-15T11:00:00Z'));

      store.updateView(viewId, {
        dbml: 'Table users { id int }',
        tableCount: 1,
        relationshipCount: 0,
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.dbml).toBe('Table users { id int }');
      expect(view.tableCount).toBe(1);
      expect(view.relationshipCount).toBe(0);
      expect(view.updatedAt).toBe('2025-01-15T11:00:00.000Z');
    });

    it('should update layout direction', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.updateView(viewId, { layoutDirection: 'TB' });

      const view = useErdStore.getState().views[viewId];
      expect(view.layoutDirection).toBe('TB');
    });

    it('should update node positions', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.updateView(viewId, {
        nodePositions: {
          'node-1': { x: 100, y: 200 },
          'node-2': { x: 300, y: 400 },
        },
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.nodePositions).toEqual({
        'node-1': { x: 100, y: 200 },
        'node-2': { x: 300, y: 400 },
      });
    });

    it('should update viewport', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.updateView(viewId, {
        viewport: { x: 50, y: 75, zoom: 1.5 },
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.viewport).toEqual({ x: 50, y: 75, zoom: 1.5 });
    });

    it('should handle non-existent view', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.updateView('non-existent', { dbml: 'test' });
      }).not.toThrow();

      expect(Object.keys(useErdStore.getState().views)).toHaveLength(0);
    });

    it('should preserve existing fields when partially updating', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.updateView(viewId, {
        dbml: 'Initial DBML',
        tableCount: 5,
      });

      store.updateView(viewId, {
        relationshipCount: 3,
      });

      const view = useErdStore.getState().views[viewId];
      expect(view.dbml).toBe('Initial DBML');
      expect(view.tableCount).toBe(5);
      expect(view.relationshipCount).toBe(3);
    });
  });

  describe('deleteView', () => {
    it('should delete a view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      expect(Object.keys(useErdStore.getState().views)).toHaveLength(1);

      store.deleteView(viewId);

      expect(Object.keys(useErdStore.getState().views)).toHaveLength(0);
    });

    it('should update active view when deleting active view', () => {
      const store = useErdStore.getState();

      const view1 = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
      });

      const view2 = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'auth',
      });

      store.setActiveView(view1);
      expect(useErdStore.getState().activeViewId).toBe(view1);

      store.deleteView(view1);

      expect(useErdStore.getState().activeViewId).toBe(view2);
    });

    it('should set active view to null when deleting last view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.deleteView(viewId);

      expect(useErdStore.getState().activeViewId).toBe(null);
    });

    it('should remove view from connection tracking', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
      });

      const key = 'conn-1::db1';
      expect(useErdStore.getState().connectionViewIds[key]).toContain(viewId);

      store.deleteView(viewId);

      expect(useErdStore.getState().connectionViewIds[key]).toBeUndefined();
    });

    it('should handle deleting non-existent view', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.deleteView('non-existent');
      }).not.toThrow();
    });
  });

  describe('renameView', () => {
    it('should rename a view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
        name: 'Original Name',
      });

      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

      store.renameView(viewId, 'New Name');

      const view = useErdStore.getState().views[viewId];
      expect(view.name).toBe('New Name');
      expect(view.updatedAt).toBe('2025-01-15T12:00:00.000Z');
    });

    it('should handle renaming non-existent view', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.renameView('non-existent', 'New Name');
      }).not.toThrow();
    });
  });

  describe('setActiveView', () => {
    it('should set active view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.setActiveView(viewId);

      expect(useErdStore.getState().activeViewId).toBe(viewId);
    });

    it('should clear active view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.setActiveView(null);

      expect(useErdStore.getState().activeViewId).toBe(null);
    });

    it('should switch between views', () => {
      const store = useErdStore.getState();

      const view1 = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
      });

      const view2 = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'auth',
      });

      store.setActiveView(view1);
      expect(useErdStore.getState().activeViewId).toBe(view1);

      store.setActiveView(view2);
      expect(useErdStore.getState().activeViewId).toBe(view2);
    });
  });

  describe('findView', () => {
    it('should find view by connection, database, and schema', () => {
      const store = useErdStore.getState();

      store.ensureView({
        connectionId: 'conn-1',
        database: 'testdb',
        schema: 'public',
      });

      const found = store.findView('conn-1', 'testdb', 'public');

      expect(found).not.toBeNull();
      expect(found?.schema).toBe('public');
    });

    it('should return null if view not found', () => {
      const store = useErdStore.getState();

      const found = store.findView('conn-1', 'testdb', 'public');

      expect(found).toBeNull();
    });

    it('should distinguish between different schemas', () => {
      const store = useErdStore.getState();

      store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
      });

      store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'auth',
      });

      const publicView = store.findView('conn-1', 'db1', 'public');
      const authView = store.findView('conn-1', 'db1', 'auth');

      expect(publicView?.schema).toBe('public');
      expect(authView?.schema).toBe('auth');
    });
  });

  describe('getActiveView', () => {
    it('should return active view', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
        name: 'Active View',
      });

      store.setActiveView(viewId);

      const active = store.getActiveView();

      expect(active).not.toBeNull();
      expect(active?.name).toBe('Active View');
    });

    it('should return null when no active view', () => {
      const store = useErdStore.getState();

      const active = store.getActiveView();

      expect(active).toBeNull();
    });

    it('should return null when active view deleted', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.setActiveView(viewId);
      store.deleteView(viewId);

      const active = store.getActiveView();

      expect(active).toBeNull();
    });
  });

  describe('getViewsForConnection', () => {
    it('should return all views for a connection', () => {
      const store = useErdStore.getState();

      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'auth' });

      const views = store.getViewsForConnection('conn-1', 'db1');

      expect(views).toHaveLength(2);
    });

    it('should return empty array if no views', () => {
      const store = useErdStore.getState();

      const views = store.getViewsForConnection('conn-1', 'db1');

      expect(views).toEqual([]);
    });

    it('should filter by database', () => {
      const store = useErdStore.getState();

      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-1', database: 'db2', schema: 'public' });

      const db1Views = store.getViewsForConnection('conn-1', 'db1');
      const db2Views = store.getViewsForConnection('conn-1', 'db2');

      expect(db1Views).toHaveLength(1);
      expect(db2Views).toHaveLength(1);
    });
  });

  describe('saveNodePosition', () => {
    it('should save node position', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      vi.setSystemTime(new Date('2025-01-15T13:00:00Z'));

      store.saveNodePosition(viewId, 'users-table', { x: 150, y: 250 });

      const view = useErdStore.getState().views[viewId];
      expect(view.nodePositions['users-table']).toEqual({ x: 150, y: 250 });
      expect(view.updatedAt).toBe('2025-01-15T13:00:00.000Z');
    });

    it('should update existing node position', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.saveNodePosition(viewId, 'users-table', { x: 100, y: 100 });
      store.saveNodePosition(viewId, 'users-table', { x: 200, y: 200 });

      const view = useErdStore.getState().views[viewId];
      expect(view.nodePositions['users-table']).toEqual({ x: 200, y: 200 });
    });

    it('should handle non-existent view', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.saveNodePosition('non-existent', 'node-1', { x: 0, y: 0 });
      }).not.toThrow();
    });

    it('should preserve other node positions', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.saveNodePosition(viewId, 'node-1', { x: 100, y: 100 });
      store.saveNodePosition(viewId, 'node-2', { x: 200, y: 200 });

      const view = useErdStore.getState().views[viewId];
      expect(view.nodePositions['node-1']).toEqual({ x: 100, y: 100 });
      expect(view.nodePositions['node-2']).toEqual({ x: 200, y: 200 });
    });
  });

  describe('saveViewport', () => {
    it('should save viewport state', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      vi.setSystemTime(new Date('2025-01-15T14:00:00Z'));

      store.saveViewport(viewId, { x: 100, y: 150, zoom: 1.2 });

      const view = useErdStore.getState().views[viewId];
      expect(view.viewport).toEqual({ x: 100, y: 150, zoom: 1.2 });
      expect(view.updatedAt).toBe('2025-01-15T14:00:00.000Z');
    });

    it('should update existing viewport', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        schema: 'public',
      });

      store.saveViewport(viewId, { x: 0, y: 0, zoom: 1 });
      store.saveViewport(viewId, { x: 50, y: 50, zoom: 2 });

      const view = useErdStore.getState().views[viewId];
      expect(view.viewport).toEqual({ x: 50, y: 50, zoom: 2 });
    });

    it('should handle non-existent view', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.saveViewport('non-existent', { x: 0, y: 0, zoom: 1 });
      }).not.toThrow();
    });
  });

  describe('clearConnectionViews', () => {
    it('should clear all views for a connection', () => {
      const store = useErdStore.getState();

      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'auth' });

      store.clearConnectionViews('conn-1', 'db1');

      const views = store.getViewsForConnection('conn-1', 'db1');
      expect(views).toHaveLength(0);
    });

    it('should preserve views from other connections', () => {
      const store = useErdStore.getState();

      store.ensureView({ connectionId: 'conn-1', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-2', database: 'db1', schema: 'public' });

      store.clearConnectionViews('conn-1', 'db1');

      const conn1Views = store.getViewsForConnection('conn-1', 'db1');
      const conn2Views = store.getViewsForConnection('conn-2', 'db1');

      expect(conn1Views).toHaveLength(0);
      expect(conn2Views).toHaveLength(1);
    });

    it('should clear active view if it belongs to connection', () => {
      const store = useErdStore.getState();

      const viewId = store.ensureView({
        connectionId: 'conn-1',
        database: 'db1',
        schema: 'public',
      });

      store.setActiveView(viewId);

      store.clearConnectionViews('conn-1', 'db1');

      expect(useErdStore.getState().activeViewId).toBe(null);
    });

    it('should handle clearing non-existent connection', () => {
      const store = useErdStore.getState();

      expect(() => {
        store.clearConnectionViews('non-existent', 'db');
      }).not.toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete ERD workflow', () => {
      const store = useErdStore.getState();

      // Create view
      const viewId = store.ensureView({
        connectionId: 'conn-prod',
        database: 'ecommerce',
        schema: 'public',
        name: 'E-commerce ERD',
      });

      // Update with DBML content
      store.updateView(viewId, {
        dbml: 'Table users { id int [pk] }',
        tableCount: 5,
        relationshipCount: 3,
      });

      // Save node positions
      store.saveNodePosition(viewId, 'users', { x: 100, y: 100 });
      store.saveNodePosition(viewId, 'products', { x: 300, y: 100 });

      // Save viewport
      store.saveViewport(viewId, { x: 0, y: 0, zoom: 1.5 });

      // Change layout direction
      store.updateView(viewId, { layoutDirection: 'TB' });

      const view = useErdStore.getState().views[viewId];
      expect(view.name).toBe('E-commerce ERD');
      expect(view.tableCount).toBe(5);
      expect(view.relationshipCount).toBe(3);
      expect(view.nodePositions).toHaveProperty('users');
      expect(view.viewport?.zoom).toBe(1.5);
      expect(view.layoutDirection).toBe('TB');
    });

    it('should handle multi-schema ERD workspace', () => {
      const store = useErdStore.getState();

      // Create views for different schemas
      const publicView = store.ensureView({
        connectionId: 'conn-1',
        database: 'app',
        schema: 'public',
      });

      const authView = store.ensureView({
        connectionId: 'conn-1',
        database: 'app',
        schema: 'auth',
      });

      const apiView = store.ensureView({
        connectionId: 'conn-1',
        database: 'app',
        schema: 'api',
      });

      // Navigate between views
      store.setActiveView(publicView);
      expect(useErdStore.getState().activeViewId).toBe(publicView);

      store.setActiveView(authView);
      expect(useErdStore.getState().activeViewId).toBe(authView);

      // Get all views for connection
      const allViews = store.getViewsForConnection('conn-1', 'app');
      expect(allViews).toHaveLength(3);
    });

    it('should handle connection cleanup', () => {
      const store = useErdStore.getState();

      // Create multiple views for connection
      store.ensureView({ connectionId: 'conn-temp', database: 'db1', schema: 'public' });
      store.ensureView({ connectionId: 'conn-temp', database: 'db1', schema: 'auth' });
      store.ensureView({ connectionId: 'conn-keep', database: 'db2', schema: 'public' });

      // Clear temporary connection
      store.clearConnectionViews('conn-temp', 'db1');

      const tempViews = store.getViewsForConnection('conn-temp', 'db1');
      const keepViews = store.getViewsForConnection('conn-keep', 'db2');

      expect(tempViews).toHaveLength(0);
      expect(keepViews).toHaveLength(1);
    });
  });
});
