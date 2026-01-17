# AVAILABLE TOOLS & USAGE PATTERNS

{{#each tools}}
## {{this.friendlyName}}
- **Name:** `{{this.name}}`
- **Description:** {{this.description}}
- **Category:** {{this.category}}
{{#if this.capabilities}}
- **Requires:** {{#each this.capabilities}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/if}}

{{/each}}
