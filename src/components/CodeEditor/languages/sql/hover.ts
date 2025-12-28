import { logger } from "@/lib/logger";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { MetadataProvider, FieldMeta, EntityDetails } from "../../types";
import { isSqlKeyword } from "./constants";
import { getQualifiedInfo } from "./shared";

interface ColumnHoverInfo {
  tableName: string;
  columnName: string;
  field: FieldMeta;
}

/**
 * Build tooltip DOM for table hover
 */
function createTableTooltip(details: EntityDetails): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-sql-hover-tooltip";

  const header = document.createElement("div");
  header.className = "cm-sql-hover-header";
  header.innerHTML = `
    <span class="cm-sql-hover-type">${details.type}</span>
    <span class="cm-sql-hover-name">${details.schema ? `${details.schema}.` : ""}${details.name}</span>
  `;
  dom.appendChild(header);

  const body = document.createElement("div");
  body.className = "cm-sql-hover-body";

  if (details.rowCount !== undefined) {
    const rowInfo = document.createElement("div");
    rowInfo.className = "cm-sql-hover-row-count";
    rowInfo.textContent = `~${details.rowCount.toLocaleString()} rows`;
    body.appendChild(rowInfo);
  }

  if (details.fields && details.fields.length > 0) {
    const colInfo = document.createElement("div");
    colInfo.className = "cm-sql-hover-col-count";
    colInfo.textContent = `${details.fields.length} columns`;
    body.appendChild(colInfo);

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

  if (details.description) {
    const desc = document.createElement("div");
    desc.className = "cm-sql-hover-description";
    desc.textContent = details.description;
    body.appendChild(desc);
  }

  dom.appendChild(body);
  return dom;
}

/**
 * Build tooltip DOM for column hover
 */
function createColumnTooltip(info: ColumnHoverInfo): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-sql-hover-tooltip";

  const header = document.createElement("div");
  header.className = "cm-sql-hover-header";

  // Build badges for column properties
  const badges: string[] = [];
  if (info.field.isPrimaryKey) badges.push('<span class="cm-sql-hover-badge pk">PK</span>');
  if (info.field.nullable === false) badges.push('<span class="cm-sql-hover-badge not-null">NOT NULL</span>');

  header.innerHTML = `
    <span class="cm-sql-hover-type">column</span>
    <span class="cm-sql-hover-name">${info.tableName}.${info.columnName}</span>
    ${badges.join("")}
  `;
  dom.appendChild(header);

  const body = document.createElement("div");
  body.className = "cm-sql-hover-body";

  // Data type (prominent)
  const typeInfo = document.createElement("div");
  typeInfo.className = "cm-sql-hover-col-type-main";
  typeInfo.innerHTML = `<strong>${info.field.dataType}</strong>`;
  body.appendChild(typeInfo);

  // Nullable info
  const nullableInfo = document.createElement("div");
  nullableInfo.className = "cm-sql-hover-info-row";
  nullableInfo.textContent = info.field.nullable === false ? "Required (NOT NULL)" : "Optional (nullable)";
  body.appendChild(nullableInfo);

  // Description if available
  if (info.field.description) {
    const desc = document.createElement("div");
    desc.className = "cm-sql-hover-description";
    desc.textContent = info.field.description;
    body.appendChild(desc);
  }

  dom.appendChild(body);
  return dom;
}

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

    if (node.name !== "Identifier" && node.name !== "QuotedIdentifier") {
      return null;
    }

    const name = state.sliceDoc(node.from, node.to).replace(/["`[\]]/g, "");

    if (isSqlKeyword(name)) {
      return null;
    }

    try {
      // Check if this is a qualified column reference (table.column)
      const qualifiedInfo = getQualifiedInfo(state, node);

      if (qualifiedInfo) {
        // Try to resolve as column
        const fields = await provider.listFields(qualifiedInfo.qualifier, defaultSchema);
        const field = fields.find(f => f.name.toLowerCase() === qualifiedInfo.name.toLowerCase());

        if (field) {
          const columnInfo: ColumnHoverInfo = {
            tableName: qualifiedInfo.qualifier,
            columnName: qualifiedInfo.name,
            field,
          };

          return {
            pos: node.from,
            end: node.to,
            above: true,
            create: () => ({ dom: createColumnTooltip(columnInfo) }),
          };
        }
      }

      // Try as table name
      if (!provider.getEntityDetails) {
        return null;
      }

      const details = await provider.getEntityDetails(name, defaultSchema);
      if (!details) return null;

      return {
        pos: node.from,
        end: node.to,
        above: true,
        create: () => ({ dom: createTableTooltip(details) }),
      };
    } catch (err) {
      logger.error("[SQL Hover] Error fetching details:", err);
      return null;
    }
  });
}
