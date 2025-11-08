import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePanelStore } from '../panelStore';

describe('panelStore', () => {
  beforeEach(() => {
    // Reset store
    usePanelStore.setState({
      panels: new Map(),
      activePanelId: '',
      splitMode: 'none',
      splitPosition: 0.5,
    });
  });

  describe('Initial State', () => {
    it('should start with empty panels', () => {
      const state = usePanelStore.getState();

      expect(state.panels.size).toBe(0);
      expect(state.activePanelId).toBe('');
      expect(state.splitMode).toBe('none');
      expect(state.splitPosition).toBe(0.5);
    });
  });

  describe('Panel Creation', () => {
    it('should create a primary panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');

      expect(panelId).toBeTruthy();
      expect(usePanelStore.getState().panels.size).toBe(1);

      const panel = store.getPanel(panelId);
      expect(panel?.type).toBe('primary');
      expect(panel?.tabs.size).toBe(0);
      expect(panel?.tabOrder).toEqual([]);
    });

    it('should create a secondary panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('secondary');

      const panel = store.getPanel(panelId);
      expect(panel?.type).toBe('secondary');
    });

    it('should create multiple panels', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      expect(usePanelStore.getState().panels.size).toBe(2);
      expect(panel1).not.toBe(panel2);
    });

    it('should create panels with unique IDs', () => {
      const store = usePanelStore.getState();

      const id1 = store.createPanel('primary');
      const id2 = store.createPanel('primary');
      const id3 = store.createPanel('secondary');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('Panel Removal', () => {
    it('should remove a panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      expect(usePanelStore.getState().panels.size).toBe(1);

      store.removePanel(panelId);
      expect(usePanelStore.getState().panels.size).toBe(0);
    });

    it('should update active panel when removing active panel', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      store.setActivePanel(panel1);
      expect(usePanelStore.getState().activePanelId).toBe(panel1);

      store.removePanel(panel1);
      expect(usePanelStore.getState().activePanelId).toBe(panel2);
    });

    it('should handle removing non-existent panel', () => {
      const store = usePanelStore.getState();

      expect(() => {
        store.removePanel('non-existent');
      }).not.toThrow();
    });
  });

  describe('Panel Activation', () => {
    it('should set active panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      store.setActivePanel(panelId);

      expect(usePanelStore.getState().activePanelId).toBe(panelId);
    });

    it('should switch active panel', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      store.setActivePanel(panel1);
      expect(usePanelStore.getState().activePanelId).toBe(panel1);

      store.setActivePanel(panel2);
      expect(usePanelStore.getState().activePanelId).toBe(panel2);
    });
  });

  describe('Split Mode', () => {
    it('should set split mode to horizontal', () => {
      const store = usePanelStore.getState();

      store.setSplitMode('horizontal');

      expect(usePanelStore.getState().splitMode).toBe('horizontal');
    });

    it('should set split mode to vertical', () => {
      const store = usePanelStore.getState();

      store.setSplitMode('vertical');

      expect(usePanelStore.getState().splitMode).toBe('vertical');
    });

    it('should set split mode to none', () => {
      const store = usePanelStore.getState();

      store.setSplitMode('horizontal');
      store.setSplitMode('none');

      expect(usePanelStore.getState().splitMode).toBe('none');
    });
  });

  describe('Split Position', () => {
    it('should set split position within valid range', () => {
      const store = usePanelStore.getState();

      store.setSplitPosition(0.6);

      expect(usePanelStore.getState().splitPosition).toBe(0.6);
    });

    it('should clamp split position to minimum 0.2', () => {
      const store = usePanelStore.getState();

      store.setSplitPosition(0.1);

      expect(usePanelStore.getState().splitPosition).toBe(0.2);
    });

    it('should clamp split position to maximum 0.8', () => {
      const store = usePanelStore.getState();

      store.setSplitPosition(0.9);

      expect(usePanelStore.getState().splitPosition).toBe(0.8);
    });
  });

  describe('Tab Management', () => {
    it('should add tab to panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, {
        title: 'Test Tab',
        type: 'query',
      });

      expect(tabId).toBeTruthy();

      const panel = store.getPanel(panelId);
      expect(panel?.tabs.size).toBe(1);
      expect(panel?.tabOrder).toContain(tabId);
      expect(panel?.activeTabId).toBe(tabId);
    });

    it('should remove tab from panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, { title: 'Tab 1' });

      store.removeTabFromPanel(panelId, tabId);

      const panel = store.getPanel(panelId);
      expect(panel?.tabs.size).toBe(0);
      expect(panel?.tabOrder).not.toContain(tabId);
    });

    it('should set active tab in panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tab1 = store.addTabToPanel(panelId, { title: 'Tab 1' });
      const tab2 = store.addTabToPanel(panelId, { title: 'Tab 2' });

      store.setActiveTabInPanel(panelId, tab1);

      const panel = store.getPanel(panelId);
      expect(panel?.activeTabId).toBe(tab1);
    });

    it('should update tab in panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, { title: 'Original Title' });

      store.updateTabInPanel(panelId, tabId, { title: 'Updated Title', isDirty: true });

      const panel = store.getPanel(panelId);
      const tab = panel?.tabs.get(tabId);
      expect(tab?.title).toBe('Updated Title');
      expect(tab?.isDirty).toBe(true);
    });

    it('should create tabs with unique IDs', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tab1 = store.addTabToPanel(panelId, { title: 'Tab 1' });
      const tab2 = store.addTabToPanel(panelId, { title: 'Tab 2' });

      expect(tab1).not.toBe(tab2);
    });

    it('should maintain tab order', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tab1 = store.addTabToPanel(panelId, { title: 'Tab 1' });
      const tab2 = store.addTabToPanel(panelId, { title: 'Tab 2' });
      const tab3 = store.addTabToPanel(panelId, { title: 'Tab 3' });

      const panel = store.getPanel(panelId);
      expect(panel?.tabOrder).toEqual([tab1, tab2, tab3]);
    });

    it('should reorder tabs in panel', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tab1 = store.addTabToPanel(panelId, { title: 'Tab 1' });
      const tab2 = store.addTabToPanel(panelId, { title: 'Tab 2' });
      const tab3 = store.addTabToPanel(panelId, { title: 'Tab 3' });

      // Move tab1 to position 2
      store.reorderTabInPanel(panelId, tab1, 2);

      const panel = store.getPanel(panelId);
      expect(panel?.tabOrder).toEqual([tab2, tab3, tab1]);
    });
  });

  describe('Tab Movement Between Panels', () => {
    it('should move tab between panels', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      const tabId = store.addTabToPanel(panel1, { title: 'Movable Tab' });

      store.moveTabBetweenPanels(tabId, panel1, panel2);

      const sourcePanel = store.getPanel(panel1);
      const targetPanel = store.getPanel(panel2);

      expect(sourcePanel?.tabs.has(tabId)).toBe(false);
      expect(targetPanel?.tabs.has(tabId)).toBe(true);
    });

    it('should remove empty secondary panel after moving last tab', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      const tabId = store.addTabToPanel(panel2, { title: 'Only Tab' });

      store.moveTabBetweenPanels(tabId, panel2, panel1);

      const state = usePanelStore.getState();
      expect(state.panels.has(panel2)).toBe(false);
      expect(state.splitMode).toBe('none');
    });

    it('should not remove primary panel when moving last tab', () => {
      const store = usePanelStore.getState();

      const panel1 = store.createPanel('primary');
      const panel2 = store.createPanel('secondary');

      const tabId = store.addTabToPanel(panel1, { title: 'Only Tab' });

      store.moveTabBetweenPanels(tabId, panel1, panel2);

      expect(usePanelStore.getState().panels.has(panel1)).toBe(true);
    });
  });

  describe('Getters', () => {
    it('should get primary panel', () => {
      const store = usePanelStore.getState();

      const primaryId = store.createPanel('primary');
      store.createPanel('secondary');

      const primaryPanel = store.getPrimaryPanel();
      expect(primaryPanel?.id).toBe(primaryId);
      expect(primaryPanel?.type).toBe('primary');
    });

    it('should get secondary panel', () => {
      const store = usePanelStore.getState();

      store.createPanel('primary');
      const secondaryId = store.createPanel('secondary');

      const secondaryPanel = store.getSecondaryPanel();
      expect(secondaryPanel?.id).toBe(secondaryId);
      expect(secondaryPanel?.type).toBe('secondary');
    });

    it('should get panel by ID', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');

      const panel = store.getPanel(panelId);
      expect(panel?.id).toBe(panelId);
    });

    it('should get current tab', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, { title: 'Current Tab' });

      store.setActivePanel(panelId);

      const currentTab = store.getCurrentTab();
      expect(currentTab?.id).toBe(tabId);
      expect(currentTab?.title).toBe('Current Tab');
    });

    it('should return undefined when no active tab', () => {
      const store = usePanelStore.getState();

      const currentTab = store.getCurrentTab();
      expect(currentTab).toBeUndefined();
    });
  });

  describe('Initialize', () => {
    it('should initialize with a primary panel and default tab', () => {
      const store = usePanelStore.getState();

      store.initialize('conn-123');

      const state = usePanelStore.getState();
      expect(state.panels.size).toBe(1);
      expect(state.splitMode).toBe('none');

      const primaryPanel = store.getPrimaryPanel();
      expect(primaryPanel).toBeDefined();
      expect(primaryPanel?.tabs.size).toBe(1);

      const tab = Array.from(primaryPanel!.tabs.values())[0];
      expect(tab.connectionId).toBe('conn-123');
      expect(tab.type).toBe('query');
    });
  });

  describe('Tab UI Updates', () => {
    it('should update tab UI state', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, { title: 'Tab' });

      store.updateTabUI(tabId, {
        scrollTop: 100,
        scrollLeft: 50,
      });

      const panel = store.getPanel(panelId);
      const tab = panel?.tabs.get(tabId);
      expect(tab?.ui.scrollTop).toBe(100);
      expect(tab?.ui.scrollLeft).toBe(50);
    });

    it('should preserve existing UI state when updating', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');
      const tabId = store.addTabToPanel(panelId, { title: 'Tab' });

      store.updateTabUI(tabId, { scrollTop: 100 });
      store.updateTabUI(tabId, { scrollLeft: 50 });

      const panel = store.getPanel(panelId);
      const tab = panel?.tabs.get(tabId);
      expect(tab?.ui.scrollTop).toBe(100);
      expect(tab?.ui.scrollLeft).toBe(50);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete split view workflow', () => {
      const store = usePanelStore.getState();

      // Create primary panel with tabs
      const primary = store.createPanel('primary');
      store.addTabToPanel(primary, { title: 'Tab 1' });
      store.addTabToPanel(primary, { title: 'Tab 2' });

      // Enable split view
      store.setSplitMode('vertical');
      store.setSplitPosition(0.6);

      // Create secondary panel
      const secondary = store.createPanel('secondary');
      store.addTabToPanel(secondary, { title: 'Tab 3' });

      const state = usePanelStore.getState();
      expect(state.panels.size).toBe(2);
      expect(state.splitMode).toBe('vertical');
      expect(state.splitPosition).toBe(0.6);
    });

    it('should handle tab lifecycle', () => {
      const store = usePanelStore.getState();

      const panelId = store.createPanel('primary');

      // Create tab
      const tabId = store.addTabToPanel(panelId, { title: 'New Query', isDirty: false });

      // Edit tab
      store.updateTabInPanel(panelId, tabId, { isDirty: true, title: 'Modified Query' });

      let tab = store.getPanel(panelId)?.tabs.get(tabId);
      expect(tab?.isDirty).toBe(true);
      expect(tab?.title).toBe('Modified Query');

      // Save tab
      store.updateTabInPanel(panelId, tabId, { isDirty: false });

      tab = store.getPanel(panelId)?.tabs.get(tabId);
      expect(tab?.isDirty).toBe(false);

      // Close tab
      store.removeTabFromPanel(panelId, tabId);
      expect(store.getPanel(panelId)?.tabs.has(tabId)).toBe(false);
    });
  });
});
