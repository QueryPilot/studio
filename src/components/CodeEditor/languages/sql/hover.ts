import { logger } from "@/lib/logger";
import { hoverTooltip, Tooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { MetadataProvider } from "../../types";

/**
 * Creates a hover tooltip extension that shows table/column information
 */
export function createSqlHoverExtension(
  provider: MetadataProvider,
  defaultSchema: string = "public"
): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const { state } = view;
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);

    // Only handle identifiers
    if (node.name !== "Identifier" && node.name !== "QuotedIdentifier") {
      return null;
    }

    const name = state.sliceDoc(node.from, node.to).replace(/["`[\]]/g, "");

    // Skip SQL keywords
    const keywords = ["select", "from", "where", "join", "on", "and", "or", "as", "in", "not", "null", "is", "like", "between", "group", "order", "by", "having", "limit", "offset", "insert", "update", "delete", "create", "alter", "drop", "table", "index", "view"];
    if (keywords.includes(name.toLowerCase())) {
      return null;
    }

    // Check if provider supports getEntityDetails
    if (!provider.getEntityDetails) {
      return null;
    }

    try {
      const details = await provider.getEntityDetails(name, defaultSchema);
      if (!details) return null;

      return {
        pos: node.from,
        end: node.to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-sql-hover-tooltip";

          // Build tooltip content
          const header = document.createElement("div");
          header.className = "cm-sql-hover-header";
          header.innerHTML = `
            <span class="cm-sql-hover-type">${details.type}</span>
            <span class="cm-sql-hover-name">${details.schema ? `${details.schema}.` : ""}${details.name}</span>
          `;
          dom.appendChild(header);

          const body = document.createElement("div");
          body.className = "cm-sql-hover-body";

          // Row count
          if (details.rowCount !== undefined) {
            const rowInfo = document.createElement("div");
            rowInfo.className = "cm-sql-hover-row-count";
            rowInfo.textContent = `~${details.rowCount.toLocaleString()} rows`;
            body.appendChild(rowInfo);
          }

          // Column count
          if (details.fields && details.fields.length > 0) {
            const colInfo = document.createElement("div");
            colInfo.className = "cm-sql-hover-col-count";
            colInfo.textContent = `${details.fields.length} columns`;
            body.appendChild(colInfo);

            // Show first few columns
            const colList = document.createElement("div");
            colList.className = "cm-sql-hover-columns";
            const previewCount = Math.min(5, details.fields.length);

            for (let i = 0; i < previewCount; i++) {
              const field = details.fields[i];
              if (!field) continue;
              const colItem = document.createElement("div");
              colItem.className = "cm-sql-hover-column";
              colItem.innerHTML = `
                <span class="cm-sql-hover-col-name">${field.name}</span>
                <span class="cm-sql-hover-col-type">${field.dataType}</span>
              `;
              colList.appendChild(colItem);
            }

            if (details.fields.length > previewCount) {
              const more = document.createElement("div");
              more.className = "cm-sql-hover-more";
              more.textContent = `+${details.fields.length - previewCount} more`;
              colList.appendChild(more);
            }

            body.appendChild(colList);
          }

          // Description
          if (details.description) {
            const desc = document.createElement("div");
            desc.className = "cm-sql-hover-description";
            desc.textContent = details.description;
            body.appendChild(desc);
          }

          dom.appendChild(body);
          return { dom };
        },
      };
    } catch (err) {
      logger.error("[SQL Hover] Error fetching details:", err);
      return null;
    }
  });
}
