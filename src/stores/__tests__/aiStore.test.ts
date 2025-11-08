import { describe, it, expect, beforeEach } from 'vitest';
import { useAIStore, type AIProviderConfig } from '../aiStore';

describe('aiStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAIStore.setState({
      selectedProvider: 'openai',
      defaultModels: {
        openai: 'gpt-5-2025-08-07',
        anthropic: 'claude-sonnet-4-5',
        google: 'gemini-2.5-pro',
        ollama: 'llama3.1',
      },
      activeModel: 'gpt-5-2025-08-07',
      providers: [],
      configuredProviders: [],
      isInitialized: false,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useAIStore.getState();

      expect(state.selectedProvider).toBe('openai');
      expect(state.activeModel).toBe('gpt-5-2025-08-07');
      expect(state.isInitialized).toBe(false);
      expect(state.providers).toEqual([]);
      expect(state.configuredProviders).toEqual([]);
    });

    it('should have default models for all providers', () => {
      const state = useAIStore.getState();

      expect(state.defaultModels).toEqual({
        openai: 'gpt-5-2025-08-07',
        anthropic: 'claude-sonnet-4-5',
        google: 'gemini-2.5-pro',
        ollama: 'llama3.1',
      });
    });
  });

  describe('Provider Selection', () => {
    it('should change selected provider', () => {
      const store = useAIStore.getState();

      store.setSelectedProvider('anthropic');
      expect(useAIStore.getState().selectedProvider).toBe('anthropic');

      store.setSelectedProvider('google');
      expect(useAIStore.getState().selectedProvider).toBe('google');
    });

    it('should allow selecting ollama provider', () => {
      const store = useAIStore.getState();

      store.setSelectedProvider('ollama');
      expect(useAIStore.getState().selectedProvider).toBe('ollama');
    });

    it('should persist provider selection across updates', () => {
      const store = useAIStore.getState();

      store.setSelectedProvider('anthropic');
      store.setActiveModel('claude-opus-4');

      expect(useAIStore.getState().selectedProvider).toBe('anthropic');
    });
  });

  describe('Default Models Management', () => {
    it('should set default model for a provider', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('openai', 'gpt-4o');

      const state = useAIStore.getState();
      expect(state.defaultModels.openai).toBe('gpt-4o');
      expect(state.defaultModels.anthropic).toBe('claude-sonnet-4-5'); // Others unchanged
    });

    it('should update default model for anthropic', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('anthropic', 'claude-opus-4');

      expect(useAIStore.getState().defaultModels.anthropic).toBe('claude-opus-4');
    });

    it('should handle setting default model for new provider', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('custom-provider', 'custom-model');

      expect(useAIStore.getState().defaultModels['custom-provider']).toBe('custom-model');
    });

    it('should update multiple default models independently', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('openai', 'gpt-4o');
      store.setDefaultModel('google', 'gemini-1.5-pro');

      const state = useAIStore.getState();
      expect(state.defaultModels.openai).toBe('gpt-4o');
      expect(state.defaultModels.google).toBe('gemini-1.5-pro');
      expect(state.defaultModels.anthropic).toBe('claude-sonnet-4-5'); // Unchanged
    });
  });

  describe('Active Model Management', () => {
    it('should set active model', () => {
      const store = useAIStore.getState();

      store.setActiveModel('gpt-4o');
      expect(useAIStore.getState().activeModel).toBe('gpt-4o');
    });

    it('should change active model multiple times', () => {
      const store = useAIStore.getState();

      store.setActiveModel('claude-opus-4');
      expect(useAIStore.getState().activeModel).toBe('claude-opus-4');

      store.setActiveModel('gemini-2.5-pro');
      expect(useAIStore.getState().activeModel).toBe('gemini-2.5-pro');
    });

    it('should allow active model different from default model', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('openai', 'gpt-4o');
      store.setActiveModel('gpt-5-2025-08-07');

      const state = useAIStore.getState();
      expect(state.defaultModels.openai).toBe('gpt-4o');
      expect(state.activeModel).toBe('gpt-5-2025-08-07');
    });
  });

  describe('Providers List Management', () => {
    const mockProviders: AIProviderConfig[] = [
      {
        name: 'openai',
        models: ['gpt-5-2025-08-07', 'gpt-4o', 'gpt-4o-mini'],
        requiresApiKey: true,
      },
      {
        name: 'anthropic',
        models: ['claude-sonnet-4-5', 'claude-opus-4'],
        requiresApiKey: true,
      },
      {
        name: 'google',
        models: ['gemini-2.5-pro', 'gemini-1.5-pro'],
        requiresApiKey: true,
      },
      {
        name: 'ollama',
        models: ['llama3.1', 'mistral', 'codellama'],
        requiresApiKey: false,
      },
    ];

    it('should set providers list', () => {
      const store = useAIStore.getState();

      store.setProviders(mockProviders);

      const state = useAIStore.getState();
      expect(state.providers).toHaveLength(4);
      expect(state.providers).toEqual(mockProviders);
    });

    it('should find provider by name', () => {
      const store = useAIStore.getState();
      store.setProviders(mockProviders);

      const state = useAIStore.getState();
      const openai = state.providers.find(p => p.name === 'openai');

      expect(openai).toBeDefined();
      expect(openai?.models).toContain('gpt-5-2025-08-07');
    });

    it('should identify providers requiring API keys', () => {
      const store = useAIStore.getState();
      store.setProviders(mockProviders);

      const state = useAIStore.getState();
      const providersNeedingKeys = state.providers.filter(p => p.requiresApiKey);

      expect(providersNeedingKeys).toHaveLength(3);
      expect(providersNeedingKeys.map(p => p.name)).toEqual(['openai', 'anthropic', 'google']);
    });

    it('should identify providers not requiring API keys', () => {
      const store = useAIStore.getState();
      store.setProviders(mockProviders);

      const state = useAIStore.getState();
      const noKeyProviders = state.providers.filter(p => !p.requiresApiKey);

      expect(noKeyProviders).toHaveLength(1);
      expect(noKeyProviders[0].name).toBe('ollama');
    });

    it('should handle empty providers list', () => {
      const store = useAIStore.getState();

      store.setProviders([]);

      expect(useAIStore.getState().providers).toEqual([]);
    });

    it('should replace providers list when set again', () => {
      const store = useAIStore.getState();

      store.setProviders(mockProviders);
      expect(useAIStore.getState().providers).toHaveLength(4);

      const newProviders = [mockProviders[0], mockProviders[1]];
      store.setProviders(newProviders);
      expect(useAIStore.getState().providers).toHaveLength(2);
    });
  });

  describe('Configured Providers Management', () => {
    it('should add configured provider', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');

      expect(useAIStore.getState().configuredProviders).toContain('openai');
    });

    it('should add multiple configured providers', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('anthropic');
      store.addConfiguredProvider('google');

      const state = useAIStore.getState();
      expect(state.configuredProviders).toHaveLength(3);
      expect(state.configuredProviders).toEqual(['openai', 'anthropic', 'google']);
    });

    it('should not add duplicate configured providers', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('openai');

      expect(useAIStore.getState().configuredProviders).toEqual(['openai']);
    });

    it('should remove configured provider', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('anthropic');
      expect(useAIStore.getState().configuredProviders).toHaveLength(2);

      store.removeConfiguredProvider('openai');

      const state = useAIStore.getState();
      expect(state.configuredProviders).toHaveLength(1);
      expect(state.configuredProviders).toEqual(['anthropic']);
    });

    it('should handle removing non-existent provider', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');
      store.removeConfiguredProvider('anthropic');

      expect(useAIStore.getState().configuredProviders).toEqual(['openai']);
    });

    it('should set configured providers list directly', () => {
      const store = useAIStore.getState();

      store.setConfiguredProviders(['openai', 'anthropic', 'google']);

      expect(useAIStore.getState().configuredProviders).toEqual(['openai', 'anthropic', 'google']);
    });

    it('should replace configured providers when set directly', () => {
      const store = useAIStore.getState();

      store.setConfiguredProviders(['openai', 'anthropic']);
      expect(useAIStore.getState().configuredProviders).toHaveLength(2);

      store.setConfiguredProviders(['google']);
      expect(useAIStore.getState().configuredProviders).toEqual(['google']);
    });

    it('should clear configured providers', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('anthropic');
      expect(useAIStore.getState().configuredProviders).toHaveLength(2);

      store.setConfiguredProviders([]);
      expect(useAIStore.getState().configuredProviders).toEqual([]);
    });
  });

  describe('Initialization Flag', () => {
    it('should start uninitialized', () => {
      expect(useAIStore.getState().isInitialized).toBe(false);
    });

    it('should mark as initialized', () => {
      const store = useAIStore.getState();

      store.setInitialized(true);
      expect(useAIStore.getState().isInitialized).toBe(true);
    });

    it('should toggle initialized state', () => {
      const store = useAIStore.getState();

      store.setInitialized(true);
      expect(useAIStore.getState().isInitialized).toBe(true);

      store.setInitialized(false);
      expect(useAIStore.getState().isInitialized).toBe(false);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete AI setup workflow', () => {
      const store = useAIStore.getState();

      // 1. Set providers list
      const providers: AIProviderConfig[] = [
        { name: 'openai', models: ['gpt-5-2025-08-07'], requiresApiKey: true },
        { name: 'anthropic', models: ['claude-sonnet-4-5'], requiresApiKey: true },
      ];
      store.setProviders(providers);

      // 2. Configure providers (API keys entered)
      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('anthropic');

      // 3. Select preferred provider
      store.setSelectedProvider('anthropic');

      // 4. Set default models
      store.setDefaultModel('anthropic', 'claude-sonnet-4-5');

      // 5. Set active model for current chat
      store.setActiveModel('claude-sonnet-4-5');

      // 6. Mark as initialized
      store.setInitialized(true);

      const state = useAIStore.getState();
      expect(state.providers).toHaveLength(2);
      expect(state.configuredProviders).toEqual(['openai', 'anthropic']);
      expect(state.selectedProvider).toBe('anthropic');
      expect(state.activeModel).toBe('claude-sonnet-4-5');
      expect(state.isInitialized).toBe(true);
    });

    it('should handle provider switch workflow', () => {
      const store = useAIStore.getState();

      // Initial setup with OpenAI
      store.setSelectedProvider('openai');
      store.setActiveModel('gpt-5-2025-08-07');
      store.addConfiguredProvider('openai');

      // Switch to Anthropic
      store.setSelectedProvider('anthropic');
      store.setActiveModel('claude-sonnet-4-5');
      store.addConfiguredProvider('anthropic');

      const state = useAIStore.getState();
      expect(state.selectedProvider).toBe('anthropic');
      expect(state.activeModel).toBe('claude-sonnet-4-5');
      expect(state.configuredProviders).toContain('openai');
      expect(state.configuredProviders).toContain('anthropic');
    });

    it('should handle unconfiguring a provider', () => {
      const store = useAIStore.getState();

      // Configure multiple providers
      store.addConfiguredProvider('openai');
      store.addConfiguredProvider('anthropic');
      store.setSelectedProvider('openai');

      // Remove OpenAI API key
      store.removeConfiguredProvider('openai');

      // Should still remember it was configured, but now removed
      const state = useAIStore.getState();
      expect(state.configuredProviders).not.toContain('openai');
      expect(state.configuredProviders).toContain('anthropic');
      expect(state.selectedProvider).toBe('openai'); // Selection unchanged
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty provider name', () => {
      const store = useAIStore.getState();

      store.setSelectedProvider('');
      expect(useAIStore.getState().selectedProvider).toBe('');
    });

    it('should handle empty model name', () => {
      const store = useAIStore.getState();

      store.setActiveModel('');
      expect(useAIStore.getState().activeModel).toBe('');
    });

    it('should handle setting default model with empty provider', () => {
      const store = useAIStore.getState();

      store.setDefaultModel('', 'some-model');
      expect(useAIStore.getState().defaultModels['']).toBe('some-model');
    });

    it('should handle adding empty configured provider', () => {
      const store = useAIStore.getState();

      store.addConfiguredProvider('');
      expect(useAIStore.getState().configuredProviders).toContain('');
    });
  });
});
