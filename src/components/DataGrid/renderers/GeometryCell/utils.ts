import type { GeometryType, ParsedGeometry } from "./types";

/**
 * List of valid geometry types
 */
export const GEOMETRY_TYPES: GeometryType[] = [
  "POINT",
  "LINESTRING",
  "POLYGON",
  "MULTIPOINT",
  "MULTILINESTRING",
  "MULTIPOLYGON",
  "GEOMETRYCOLLECTION",
];

/**
 * Common SRIDs
 */
export const COMMON_SRIDS = [
  { value: 4326, label: "WGS 84 (GPS)" },
  { value: 3857, label: "Web Mercator" },
  { value: 4269, label: "NAD83" },
  { value: 2154, label: "RGF93 / Lambert-93 (France)" },
  { value: 32632, label: "WGS 84 / UTM zone 32N" },
];

/**
 * Parse WKT or EWKT string
 */
export function parseGeometry(wkt: string | null): ParsedGeometry {
  if (!wkt || wkt.trim() === "") {
    return {
      type: null,
      srid: null,
      coordinates: "",
      isValid: true,
    };
  }

  const trimmed = wkt.trim();

  // Check for EWKT format: SRID=4326;POINT(...)
  let srid: number | null = null;
  let wktPart = trimmed;

  const sridMatch = trimmed.match(/^SRID=(\d+);(.+)$/i);
  if (sridMatch && sridMatch[1] && sridMatch[2]) {
    srid = parseInt(sridMatch[1], 10);
    wktPart = sridMatch[2];
  }

  // Parse geometry type
  const typeMatch = wktPart.match(/^(\w+)\s*\(/i);
  if (!typeMatch) {
    return {
      type: null,
      srid,
      coordinates: wktPart,
      isValid: false,
      error: "Invalid geometry format - missing type",
    };
  }

  const typeStr = typeMatch[1]?.toUpperCase() ?? "";
  const type = GEOMETRY_TYPES.includes(typeStr as GeometryType)
    ? (typeStr as GeometryType)
    : null;

  if (!type) {
    return {
      type: null,
      srid,
      coordinates: wktPart,
      isValid: false,
      error: `Unknown geometry type: ${typeStr}`,
    };
  }

  // Extract coordinates
  const coordsMatch = wktPart.match(/^\w+\s*\((.+)\)$/i);
  const coordinates = coordsMatch?.[1] ?? "";

  // Validate parentheses balance
  const openCount = (wktPart.match(/\(/g) || []).length;
  const closeCount = (wktPart.match(/\)/g) || []).length;
  if (openCount !== closeCount) {
    return {
      type,
      srid,
      coordinates,
      isValid: false,
      error: "Unbalanced parentheses",
    };
  }

  // Basic coordinate validation
  const validationResult = validateCoordinates(type, coordinates);
  if (!validationResult.isValid) {
    return {
      type,
      srid,
      coordinates,
      isValid: false,
      error: validationResult.error,
    };
  }

  return {
    type,
    srid,
    coordinates,
    isValid: true,
  };
}

/**
 * Basic coordinate validation
 */
function validateCoordinates(
  type: GeometryType,
  coords: string,
): { isValid: boolean; error?: string } {
  if (!coords.trim()) {
    // Empty geometry is valid for some types
    if (type === "GEOMETRYCOLLECTION") {
      return { isValid: true };
    }
    return { isValid: false, error: "Empty coordinates" };
  }

  // Check for valid coordinate numbers
  const numbers = coords.match(/-?\d+\.?\d*/g);
  if (!numbers || numbers.length === 0) {
    return { isValid: false, error: "No valid coordinates found" };
  }

  // Type-specific validation
  switch (type) {
    case "POINT":
      // Should have 2-4 numbers (x y [z] [m])
      if (numbers.length < 2 || numbers.length > 4) {
        return {
          isValid: false,
          error: "POINT should have 2-4 coordinates (x y [z] [m])",
        };
      }
      break;
    case "LINESTRING":
      // Should have at least 4 numbers (2 points)
      if (numbers.length < 4) {
        return {
          isValid: false,
          error: "LINESTRING should have at least 2 points",
        };
      }
      break;
    case "POLYGON":
      // Should have at least 8 numbers (4 points for a closed ring)
      if (numbers.length < 8) {
        return {
          isValid: false,
          error: "POLYGON should have at least 4 points",
        };
      }
      break;
  }

  return { isValid: true };
}

/**
 * Format geometry as WKT
 */
export function formatWkt(
  type: GeometryType | null,
  coordinates: string,
  srid: number | null,
): string {
  if (!type) return "";

  const wkt = `${type}(${coordinates})`;
  if (srid) {
    return `SRID=${srid};${wkt}`;
  }
  return wkt;
}

/**
 * Get preview text for geometry
 */
export function getGeometryPreview(wkt: string | null): string {
  if (!wkt) return "NULL";

  const parsed = parseGeometry(wkt);
  if (!parsed.type) {
    return wkt.length > 30 ? wkt.substring(0, 30) + "..." : wkt;
  }

  // Show type and first coordinate
  const coordPreview = parsed.coordinates.length > 20
    ? parsed.coordinates.substring(0, 20) + "..."
    : parsed.coordinates;

  return `${parsed.type}(${coordPreview})`;
}

/**
 * Get short type badge
 */
export function getTypeBadge(wkt: string | null): string {
  if (!wkt) return "NULL";

  const parsed = parseGeometry(wkt);
  if (!parsed.type) return "?";

  const typeAbbr: Record<GeometryType, string> = {
    POINT: "PT",
    LINESTRING: "LS",
    POLYGON: "PG",
    MULTIPOINT: "MPT",
    MULTILINESTRING: "MLS",
    MULTIPOLYGON: "MPG",
    GEOMETRYCOLLECTION: "GC",
  };

  return typeAbbr[parsed.type] || parsed.type.substring(0, 3);
}

/**
 * Get example coordinates for a geometry type
 */
export function getExampleCoordinates(type: GeometryType): string {
  switch (type) {
    case "POINT":
      return "0 0";
    case "LINESTRING":
      return "0 0, 1 1, 2 0";
    case "POLYGON":
      return "(0 0, 1 0, 1 1, 0 1, 0 0)";
    case "MULTIPOINT":
      return "(0 0), (1 1), (2 2)";
    case "MULTILINESTRING":
      return "((0 0, 1 1), (2 2, 3 3))";
    case "MULTIPOLYGON":
      return "(((0 0, 1 0, 1 1, 0 0)))";
    case "GEOMETRYCOLLECTION":
      return "POINT(0 0), LINESTRING(0 0, 1 1)";
  }
}

/**
 * Try to extract a single point from geometry for map centering
 */
export function extractCenterPoint(wkt: string | null): { x: number; y: number } | null {
  if (!wkt) return null;

  const parsed = parseGeometry(wkt);
  if (!parsed.isValid) return null;

  // Extract first coordinate pair
  const numbers = parsed.coordinates.match(/-?\d+\.?\d*/g);
  if (!numbers || numbers.length < 2) return null;

  const x = parseFloat(numbers[0] ?? "");
  const y = parseFloat(numbers[1] ?? "");

  if (isNaN(x) || isNaN(y)) return null;

  return { x, y };
}

/**
 * Generate simple SVG path for geometry preview
 */
export function generateSvgPreview(
  wkt: string | null,
  width: number = 40,
  height: number = 40,
): string | null {
  if (!wkt) return null;

  const parsed = parseGeometry(wkt);
  if (!parsed.isValid || !parsed.type) return null;

  // Extract all coordinates
  const numbers = parsed.coordinates.match(/-?\d+\.?\d*/g);
  if (!numbers || numbers.length < 2) return null;

  // Parse coordinate pairs
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < numbers.length - 1; i += 2) {
    points.push({
      x: parseFloat(numbers[i] ?? ""),
      y: parseFloat(numbers[i + 1] ?? ""),
    });
  }

  if (points.length === 0) return null;

  // Calculate bounds
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Scale points to SVG coordinates
  const padding = 4;
  const scaledPoints = points.map((p) => ({
    x: padding + ((p.x - minX) / rangeX) * (width - padding * 2),
    y: padding + ((maxY - p.y) / rangeY) * (height - padding * 2), // Flip Y
  }));

  // Generate SVG based on geometry type
  switch (parsed.type) {
    case "POINT": {
      const pt = scaledPoints[0];
      if (!pt) return null;
      return `<circle cx="${pt.x}" cy="${pt.y}" r="3" fill="currentColor"/>`;
    }
    case "LINESTRING":
      const linePath = scaledPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
      return `<path d="${linePath}" fill="none" stroke="currentColor" stroke-width="1.5"/>`;

    case "POLYGON":
      const polyPath = scaledPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";
      return `<path d="${polyPath}" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1"/>`;

    case "MULTIPOINT":
      return scaledPoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2" fill="currentColor"/>`).join("");

    default:
      return null;
  }
}

