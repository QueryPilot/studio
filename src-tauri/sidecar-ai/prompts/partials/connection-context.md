# CURRENT CONNECTION CONTEXT
- Connection ID: {{connection.connectionId}}
- Database: {{connection.database}}
- Schema: {{connection.schema}}
- Database Type: {{connection.paradigm}}

{{#if connection.activeTable}}
## Active Context
- **Currently viewing table:** {{connection.activeTable}}
  The user is currently focused on this table. Prioritize questions and suggestions related to it.
{{/if}}

{{#if connection.activeCollection}}
## Active Context
- **Currently viewing collection:** {{connection.activeCollection}}
  The user is currently focused on this collection. Prioritize questions and suggestions related to it.
{{/if}}

{{#if connection.activeKey}}
## Active Context
- **Currently viewing key:** {{connection.activeKey}}
  The user is currently focused on this key. Prioritize questions and suggestions related to it.
{{/if}}

{{#if connection.recentTables}}
{{#if connection.recentTables.length}}
## Recently Viewed Tables
{{#each connection.recentTables}}
- {{this}}
{{/each}}
The user has been working with these tables recently. They may be interested in relationships between them.
{{/if}}
{{/if}}

{{#if connection.recentCollections}}
{{#if connection.recentCollections.length}}
## Recently Viewed Collections
{{#each connection.recentCollections}}
- {{this}}
{{/each}}
{{/if}}
{{/if}}

---

{{#if connection.paradigm}}
{{#if (eq connection.paradigm "sql")}}
{{> sql-context}}
{{/if}}
{{#if (eq connection.paradigm "document")}}
{{> document-context}}
{{/if}}
{{#if (eq connection.paradigm "keyvalue")}}
{{> keyvalue-context}}
{{/if}}
{{/if}}
