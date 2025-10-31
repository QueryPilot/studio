// Store API keys in memory (set via /config endpoint)
const apiKeys: Record<string, string> = {};

// Track configuration state
let configLoaded = false;

export class ConfigService {
  static getApiKey(provider: string): string | undefined {
    return apiKeys[provider];
  }

  static setApiKeys(keys: Record<string, string>): string[] {
    const configured: string[] = [];

    Object.entries(keys).forEach(([provider, key]) => {
      if (key && key.trim()) {
        apiKeys[provider] = key.trim();
        configured.push(provider);
        console.log(`✅ API key configured for provider: ${provider}`);
      }
    });

    configLoaded = true;
    console.log(
      `✅ Sidecar configuration loaded. Providers: ${configured.join(", ")}`,
    );

    return configured;
  }

  static getConfiguredProviders(): string[] {
    return Object.keys(apiKeys);
  }

  static isConfigLoaded(): boolean {
    return configLoaded;
  }
}
