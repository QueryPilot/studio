/**
 * Column type icons for DataGrid headers
 * SVG paths extracted from Tabler Icons for canvas rendering
 * All icons use 24x24 viewBox, scaled down for header display
 */

export type ColumnIconType =
  | 'pk'
  | 'fk'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'array'
  | 'binary'
  | 'enum'
  | 'money'
  | 'spatial';

interface IconDefinition {
  paths: string[];
  color: string;
  colorDark: string;
  strokeWidth?: number;
  fill?: boolean;
}

// Tabler icon paths (24x24 viewBox) with colors for light and dark mode
const ICON_DEFINITIONS: Record<ColumnIconType, IconDefinition> = {
  // IconKey - Primary Key
  pk: {
    paths: [
      'M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z',
      'M15 9h.01',
    ],
    color: '#d97706', // amber-600
    colorDark: '#fbbf24', // amber-400
    strokeWidth: 1.5,
  },
  // IconLink - Foreign Key
  fk: {
    paths: [
      'M9 15l6 -6',
      'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
      'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
    ],
    color: '#2563eb', // blue-600
    colorDark: '#60a5fa', // blue-400
    strokeWidth: 1.5,
  },
  // IconBlockquote - Text/String
  text: {
    paths: [
      'M6 15h15',
      'M21 19h-15',
      'M15 11h6',
      'M21 7h-6',
      'M9 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2',
      'M3 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2',
    ],
    color: '#4b5563', // gray-600
    colorDark: '#9ca3af', // gray-400
    strokeWidth: 1.5,
  },
  // IconNumber - Integer
  integer: {
    paths: [
      'M4 17v-10l7 10v-10',
      'M15 17h5',
      'M17.5 10m-2.5 0a2.5 3 0 1 0 5 0a2.5 3 0 1 0 -5 0',
    ],
    color: '#7c3aed', // violet-600
    colorDark: '#a78bfa', // violet-400
    strokeWidth: 1.5,
  },
  // IconNumber - Decimal/Float (same as integer)
  decimal: {
    paths: [
      'M4 17v-10l7 10v-10',
      'M15 17h5',
      'M17.5 10m-2.5 0a2.5 3 0 1 0 5 0a2.5 3 0 1 0 -5 0',
    ],
    color: '#7c3aed', // violet-600
    colorDark: '#a78bfa', // violet-400
    strokeWidth: 1.5,
  },
  // IconCheckbox - Boolean
  boolean: {
    paths: [
      'M9 11l3 3l8 -8',
      'M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9',
    ],
    color: '#059669', // emerald-600
    colorDark: '#34d399', // emerald-400
    strokeWidth: 1.5,
  },
  // IconCalendar - Date
  date: {
    paths: [
      'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z',
      'M16 3v4',
      'M8 3v4',
      'M4 11h16',
      'M11 15h1',
      'M12 15v3',
    ],
    color: '#0284c7', // sky-600
    colorDark: '#38bdf8', // sky-400
    strokeWidth: 1.5,
  },
  // IconClock - Time
  time: {
    paths: [
      'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
      'M12 7v5l3 3',
    ],
    color: '#0284c7', // sky-600
    colorDark: '#38bdf8', // sky-400
    strokeWidth: 1.5,
  },
  // IconCalendarTime - Timestamp
  timestamp: {
    paths: [
      'M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4',
      'M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
      'M15 3v4',
      'M7 3v4',
      'M3 11h16',
      'M18 16.496v1.504l1 1',
    ],
    color: '#0284c7', // sky-600
    colorDark: '#38bdf8', // sky-400
    strokeWidth: 1.5,
  },
  // IconBraces - JSON
  json: {
    paths: [
      'M7 4a2 2 0 0 0 -2 2v3a2 3 0 0 1 -2 3a2 3 0 0 1 2 3v3a2 2 0 0 0 2 2',
      'M17 4a2 2 0 0 1 2 2v3a2 3 0 0 0 2 3a2 3 0 0 0 -2 3v3a2 2 0 0 1 -2 2',
    ],
    color: '#ea580c', // orange-600
    colorDark: '#fb923c', // orange-400
    strokeWidth: 1.5,
  },
  // IconAsterisk - UUID
  uuid: {
    paths: [
      'M12 12l8 -4.5',
      'M12 12v9',
      'M12 12l-8 -4.5',
      'M12 12l8 4.5',
      'M12 3v9',
      'M12 12l-8 4.5',
    ],
    color: '#db2777', // pink-600
    colorDark: '#f472b6', // pink-400
    strokeWidth: 1.5,
  },
  // IconBrackets - Array
  array: {
    paths: [
      'M8 4h-3a1 1 0 0 0 -1 1v14a1 1 0 0 0 1 1h3',
      'M16 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-3',
    ],
    color: '#0d9488', // teal-600
    colorDark: '#2dd4bf', // teal-400
    strokeWidth: 1.5,
  },
  // IconBinary - Binary/Blob/tsvector/hstore
  binary: {
    paths: [
      'M11 10v-5h-1m8 14v-5h-1',
      'M15 5m0 .5a.5 .5 0 0 1 .5 -.5h2a.5 .5 0 0 1 .5 .5v4a.5 .5 0 0 1 -.5 .5h-2a.5 .5 0 0 1 -.5 -.5z',
      'M10 14m0 .5a.5 .5 0 0 1 .5 -.5h2a.5 .5 0 0 1 .5 .5v4a.5 .5 0 0 1 -.5 .5h-2a.5 .5 0 0 1 -.5 -.5z',
      'M6 10h.01m-.01 9h.01',
    ],
    color: '#475569', // slate-600
    colorDark: '#94a3b8', // slate-400
    strokeWidth: 1.5,
  },
  // IconList - Enum
  enum: {
    paths: [
      'M9 6l11 0',
      'M9 12l11 0',
      'M9 18l11 0',
      'M5 6l0 .01',
      'M5 12l0 .01',
      'M5 18l0 .01',
    ],
    color: '#9333ea', // purple-600
    colorDark: '#c084fc', // purple-400
    strokeWidth: 1.5,
  },
  // IconCurrencyDollar - Money
  money: {
    paths: [
      'M16.7 8a3 3 0 0 0 -2.7 -2h-4a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6h-4a3 3 0 0 1 -2.7 -2',
      'M12 3v3m0 12v3',
    ],
    color: '#16a34a', // green-600
    colorDark: '#4ade80', // green-400
    strokeWidth: 1.5,
  },
  // IconMapPin - Spatial/Geo
  spatial: {
    paths: [
      'M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
      'M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z',
    ],
    color: '#0891b2', // cyan-600
    colorDark: '#22d3ee', // cyan-400
    strokeWidth: 1.5,
  },
};

// Cache for rendered icons
const iconCache = new Map<string, ImageBitmap>();

/**
 * Get icon type from column metadata
 */
export function getIconTypeFromMeta(meta: {
  db_type?: string;
  is_pk?: boolean;
  is_fk?: boolean;
  is_json?: boolean;
  enum_values?: string[];
  nullable?: boolean;
} | null | undefined): ColumnIconType {
  if (!meta) return 'text';

  // Priority: PK > FK > data type
  if (meta.is_pk) return 'pk';
  if (meta.is_fk) return 'fk';

  // Check for enum
  if (Array.isArray(meta.enum_values) && meta.enum_values.length > 0) {
    return 'enum';
  }

  // Check for JSON flag
  if (meta.is_json) return 'json';

  const t = (meta.db_type ?? '').toLowerCase();

  // JSON types (includes composite/record)
  if (t.includes('json') || t.includes('record') || t.includes('composite')) {
    return 'json';
  }

  // UUID types
  if (t.includes('uuid') || t.includes('uniqueidentifier')) return 'uuid';

  // Binary types (includes PostgreSQL special types)
  if (t.includes('bytea') || t.includes('blob') || t.includes('binary') || t.includes('varbinary') ||
      t.includes('tsvector') || t.includes('tsquery') || t.includes('hstore') ||
      t === 'bit' || t === 'varbit') {
    return 'binary';
  }

  // Money types
  if (t.includes('money')) return 'money';

  // Spatial/Geometric types
  if (t.includes('geometry') || t.includes('geography') || t.includes('point') ||
      t.includes('polygon') || t.includes('linestring') || t.includes('lseg') ||
      t.includes('path') || t.includes('box') || t.includes('circle') || t.includes('line')) {
    return 'spatial';
  }

  // Network types - treat as text (no specific icon)
  if (t.includes('inet') || t.includes('cidr') || t.includes('macaddr')) {
    return 'text';
  }

  // XML types - treat as text
  if (t.includes('xml')) return 'text';

  // Array types
  if (t.includes('array') || t.endsWith('[]')) return 'array';

  // Boolean types
  if (t.includes('bool')) return 'boolean';

  // Timestamp types (before date/time to catch combined)
  // Includes range types: tstzrange, tsrange, and interval
  if (t.includes('timestamp') || t.includes('datetime') || t.includes('tstzrange') ||
      t.includes('tsrange') || t.includes('interval')) {
    return 'timestamp';
  }

  // Time types (excludes timestamp which is caught above)
  if (t.includes('time') && !t.includes('stamp')) return 'time';

  // Date types (includes daterange)
  if (t.includes('date') || t.includes('daterange')) return 'date';

  // Decimal/Float types
  if (t.includes('numeric') || t.includes('decimal') || t.includes('float') ||
      t.includes('double') || t.includes('real') || t.includes('numrange')) {
    return 'decimal';
  }

  // Integer types (includes int ranges)
  if (t.includes('int') || t.includes('serial') || t.includes('oid') ||
      t.includes('int4range') || t.includes('int8range')) {
    return 'integer';
  }

  // Text types (default for string-like)
  if (t.includes('char') || t.includes('text') || t.includes('string') ||
      t.includes('varchar') || t.includes('nvarchar') || t.includes('clob') ||
      t.includes('name')) {
    return 'text';
  }

  // Default fallback to text for unknown types
  return 'text';
}

/**
 * Pre-render an icon to an offscreen canvas and return ImageBitmap
 */
async function renderIconToBitmap(
  iconType: ColumnIconType,
  size: number,
  color?: string
): Promise<ImageBitmap> {
  const cacheKey = `${iconType}-${size}-${color ?? 'default'}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const def = ICON_DEFINITIONS[iconType];
  const actualColor = color ?? def.color;

  // Create offscreen canvas
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  // Scale from 24x24 to target size
  const scale = size / 24;
  ctx.scale(scale, scale);

  // Set up stroke style
  ctx.strokeStyle = actualColor;
  ctx.lineWidth = def.strokeWidth ?? 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (def.fill) {
    ctx.fillStyle = actualColor;
  }

  // Draw all paths
  for (const pathData of def.paths) {
    const path = new Path2D(pathData);
    if (def.fill) {
      ctx.fill(path);
    } else {
      ctx.stroke(path);
    }
  }

  const bitmap = await createImageBitmap(canvas);
  iconCache.set(cacheKey, bitmap);
  return bitmap;
}

/**
 * Draw a column type icon on a canvas context
 */
export function drawColumnIcon(
  ctx: CanvasRenderingContext2D,
  iconType: ColumnIconType,
  x: number,
  y: number,
  size: number = 12,
  isDark: boolean = false
): void {
  const def = ICON_DEFINITIONS[iconType];
  const color = isDark ? def.colorDark : def.color;

  ctx.save();

  // Translate and scale
  ctx.translate(x, y - size / 2);
  const scale = size / 24;
  ctx.scale(scale, scale);

  // Set up stroke style
  ctx.strokeStyle = color;
  ctx.lineWidth = def.strokeWidth ?? 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (def.fill) {
    ctx.fillStyle = color;
  }

  // Draw all paths
  for (const pathData of def.paths) {
    const path = new Path2D(pathData);
    if (def.fill) {
      ctx.fill(path);
    } else {
      ctx.stroke(path);
    }
  }

  ctx.restore();
}

/**
 * Get the color for an icon type
 */
export function getIconColor(iconType: ColumnIconType): string {
  return ICON_DEFINITIONS[iconType].color;
}

/**
 * Pre-warm the icon cache for common sizes
 */
export async function preWarmIconCache(sizes: number[] = [12, 14, 16]): Promise<void> {
  const types = Object.keys(ICON_DEFINITIONS) as ColumnIconType[];
  const promises: Promise<ImageBitmap>[] = [];

  for (const type of types) {
    for (const size of sizes) {
      promises.push(renderIconToBitmap(type, size));
    }
  }

  await Promise.all(promises);
}
