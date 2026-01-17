/**
 * Prompt Engine
 *
 * Loads and renders markdown templates using Handlebars.
 */

import Handlebars from "handlebars";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PromptContext {
  connection?: {
    connectionId: string;
    database: string;
    schema: string;
    paradigm?: string;
    activeTable?: string | null;
    activeCollection?: string | null;
    activeKey?: string | null;
    recentTables?: string[];
    recentCollections?: string[];
    lastAction?: "browse" | "query" | "filter" | null;
  };
  tools?: Array<{
    name: string;
    friendlyName: string;
    description: string;
    category: string;
    capabilities: string[];
  }>;
  maxToolSteps?: number;
  [key: string]: unknown;
}

export class PromptEngine {
  private templates = new Map<string, HandlebarsTemplateDelegate>();
  private partials = new Map<string, string>();

  constructor() {
    // Register Handlebars helpers
    this.registerHelpers();
  }

  /**
   * Register Handlebars helpers
   */
  private registerHelpers(): void {
    // Equality comparison helper
    Handlebars.registerHelper("eq", function (a, b) {
      return a === b;
    });

    // Length helper
    Handlebars.registerHelper("length", function (array) {
      return Array.isArray(array) ? array.length : 0;
    });
  }

  /**
   * Load all markdown templates and partials
   */
  async load(): Promise<void> {
    // Load partials first
    await this.loadPartials();

    // Load main templates
    await this.loadTemplates();

    console.log(
      `[PromptEngine] Loaded ${this.templates.size} templates and ${this.partials.size} partials`
    );
  }

  /**
   * Load partial templates
   */
  private async loadPartials(): Promise<void> {
    const partialsDir = join(__dirname, "partials");
    const glob = new Bun.Glob("**/*.md");

    for await (const file of glob.scan({ cwd: partialsDir })) {
      const path = join(partialsDir, file);
      const content = await Bun.file(path).text();

      // Partial name is filename without extension
      const name = file.replace(/\.md$/, "");
      this.partials.set(name, content);

      // Register with Handlebars
      Handlebars.registerPartial(name, content);

      console.log(`[PromptEngine] Registered partial: ${name}`);
    }
  }

  /**
   * Load main templates
   */
  private async loadTemplates(): Promise<void> {
    const templatesDir = join(__dirname, "chat");
    const glob = new Bun.Glob("**/*.md");

    for await (const file of glob.scan({ cwd: templatesDir })) {
      const path = join(templatesDir, file);
      const content = await Bun.file(path).text();

      // Template name is path relative to chat dir, without extension
      const name = file.replace(/\.md$/, "");

      // Compile template
      const template = Handlebars.compile(content);
      this.templates.set(name, template);

      console.log(`[PromptEngine] Compiled template: ${name}`);
    }
  }

  /**
   * Render a template with the given context
   */
  render(templateName: string, context: PromptContext = {}): string {
    const template = this.templates.get(templateName);

    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    return template(context);
  }

  /**
   * Get all available template names
   */
  getTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Get all available partial names
   */
  getPartialNames(): string[] {
    return Array.from(this.partials.keys());
  }

  /**
   * Reload all templates (useful for development)
   */
  async reload(): Promise<void> {
    this.templates.clear();
    this.partials.clear();
    Handlebars.unregisterPartial("connection-context");
    Handlebars.unregisterPartial("no-connection");
    Handlebars.unregisterPartial("tools-list");
    await this.load();
  }
}

// Singleton instance
let engineInstance: PromptEngine | null = null;

/**
 * Get or create the prompt engine instance
 */
export async function getPromptEngine(): Promise<PromptEngine> {
  if (!engineInstance) {
    engineInstance = new PromptEngine();
    await engineInstance.load();
  }
  return engineInstance;
}
