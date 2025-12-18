import type { XmlValidationResult } from "./types";

/**
 * Validate XML string using DOMParser
 */
export function validateXml(xml: string | null): XmlValidationResult {
  if (!xml || xml.trim() === "") {
    return { isValid: true };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");

    // Check for parser errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      const errorText = parseError.textContent || "Invalid XML";

      // Try to extract line/column from error message
      const lineMatch = errorText.match(/line\s+(\d+)/i);
      const colMatch = errorText.match(/column\s+(\d+)/i);

      return {
        isValid: false,
        error: errorText.split("\n")[0] || "Invalid XML",
        errorLine: lineMatch?.[1] ? parseInt(lineMatch[1], 10) : undefined,
        errorColumn: colMatch?.[1] ? parseInt(colMatch[1], 10) : undefined,
      };
    }

    return { isValid: true };
  } catch (e) {
    return {
      isValid: false,
      error: e instanceof Error ? e.message : "Invalid XML",
    };
  }
}

/**
 * Format/pretty-print XML with proper indentation
 */
export function formatXml(xml: string | null, indent: number = 2): string {
  if (!xml || xml.trim() === "") return xml ?? "";

  try {
    // Parse and re-serialize with formatting
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");

    // Check for parse errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return xml; // Return original if invalid
    }

    return serializeWithIndent(doc.documentElement, 0, indent);
  } catch {
    return xml; // Return original if formatting fails
  }
}

/**
 * Serialize XML node with proper indentation
 */
function serializeWithIndent(
  node: Element,
  level: number,
  indentSize: number,
): string {
  const indent = " ".repeat(level * indentSize);
  const childIndent = " ".repeat((level + 1) * indentSize);

  let result = `${indent}<${node.tagName}`;

  // Add attributes
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i];
    if (attr) {
      result += ` ${attr.name}="${escapeXml(attr.value)}"`;
    }
  }

  // Check for children
  const childElements = Array.from(node.children);
  const textContent = getDirectTextContent(node);

  if (childElements.length === 0 && !textContent) {
    // Self-closing tag
    result += "/>";
  } else if (childElements.length === 0 && textContent) {
    // Text-only content
    result += `>${escapeXml(textContent)}</${node.tagName}>`;
  } else {
    // Has child elements
    result += ">";

    if (textContent) {
      result += `\n${childIndent}${escapeXml(textContent)}`;
    }

    for (const child of childElements) {
      result += "\n" + serializeWithIndent(child, level + 1, indentSize);
    }

    result += `\n${indent}</${node.tagName}>`;
  }

  return result;
}

/**
 * Get direct text content of an element (not from children)
 */
function getDirectTextContent(node: Element): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const trimmed = child.textContent?.trim() ?? "";
      if (trimmed) text += trimmed;
    }
  }
  return text;
}

/**
 * Minify XML (remove unnecessary whitespace)
 */
export function minifyXml(xml: string | null): string {
  if (!xml) return "";

  return xml
    .replace(/>\s+</g, "><") // Remove whitespace between tags
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Escape special XML characters
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Get a short preview of XML content
 */
export function getXmlPreview(xml: string | null, maxLength: number = 50): string {
  if (!xml) return "NULL";

  const trimmed = xml.trim();

  // Try to extract root tag
  const rootMatch = trimmed.match(/^<([^\s>]+)/);
  if (rootMatch) {
    const tagName = rootMatch[1];
    const content = trimmed.substring(rootMatch[0].length);

    if (content.length > maxLength) {
      return `<${tagName}>...`;
    }
  }

  if (trimmed.length > maxLength) {
    return trimmed.substring(0, maxLength) + "...";
  }

  return trimmed;
}

/**
 * Count lines in XML string
 */
export function countLines(xml: string | null): number {
  if (!xml) return 0;
  return xml.split("\n").length;
}

