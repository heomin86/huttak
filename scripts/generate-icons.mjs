import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'public', 'icon');
const SVG_PATH = join(ROOT, 'scripts', 'icon.svg');
const LOGO_PATH = join(ROOT, 'scripts', 'logo.svg');
const MARK_MODULE_PATH = join(ROOT, 'src', 'dom', 'mark.generated.ts');
const SIZES = [16, 32, 48, 128];
const DESIGN_SIZE = 128;
const SAMPLES_PER_AXIS = 6;

const COLORS = {
  background: [16, 24, 40],
  primary: [248, 250, 252],
  accent: [251, 146, 60],
};

const BACKGROUND = { x: 0, y: 0, width: 128, height: 128, radius: 26 };
// The mark is the Hangul letter ㅎ (the first sound of 후딱, "in a flash"), leaning
// forward, with three orange speed lines behind it. The short top stroke is orange too, so
// the letter keeps one accent at each end. The icon draws it slightly smaller so the tips
// stay inside the rounded plate.
const MARK_SCALE = 0.86;
const ACCENT = '#fb923c';
const WHITE = '#f8fafc';
const LEAN = 0.16;

function lean(polygon) {
  return polygon.map(([x, y]) => [x + (64 - y) * LEAN, y]);
}

function rect(x1, y1, x2, y2) {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function circle(cx, cy, r, steps = 64) {
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
}

// A part is an outer outline with optional holes (the ring of ㅇ).
const ACCENT_PARTS = [
  { outer: lean(rect(52, 20, 80, 30)) },
  { outer: lean(rect(8, 70, 30, 76)) },
  { outer: lean(rect(2, 82, 30, 88)) },
  { outer: lean(rect(12, 94, 30, 100)) },
];
const WHITE_PARTS = [
  { outer: lean(rect(30, 37, 102, 48)) },
  { outer: lean(circle(68, 83, 27)), holes: [lean(circle(68, 83, 14))] },
];

function fitPolygon(polygon) {
  return polygon.map(([x, y]) => [64 + (x - 64) * MARK_SCALE, 64 + (y - 64) * MARK_SCALE]);
}

function fit(part) {
  return { outer: fitPolygon(part.outer), holes: (part.holes ?? []).map(fitPolygon) };
}

const ICON_ACCENT = ACCENT_PARTS.map(fit);
const ICON_WHITE = WHITE_PARTS.map(fit);

function isInsideRoundedRect(x, y, rect) {
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  if (x < rect.x || x > maxX || y < rect.y || y > maxY) return false;

  const innerX = Math.min(Math.max(x, rect.x + rect.radius), maxX - rect.radius);
  const innerY = Math.min(Math.max(y, rect.y + rect.radius), maxY - rect.radius);
  const dx = x - innerX;
  const dy = y - innerY;
  return dx * dx + dy * dy <= rect.radius * rect.radius;
}

function isInsidePolygon(x, y, polygon) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const [currentX, currentY] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const crosses = currentY > y !== previousY > y;
    if (!crosses) continue;
    const intersection =
      ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (x < intersection) inside = !inside;
  }
  return inside;
}

function covers(x, y, parts) {
  return parts.some(
    (part) =>
      isInsidePolygon(x, y, part.outer) &&
      !(part.holes ?? []).some((hole) => isInsidePolygon(x, y, hole)),
  );
}

function colorAt(x, y) {
  if (covers(x, y, ICON_WHITE)) return COLORS.primary;
  if (covers(x, y, ICON_ACCENT)) return COLORS.accent;
  if (isInsideRoundedRect(x, y, BACKGROUND)) return COLORS.background;
  return null;
}

function renderRgba(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = DESIGN_SIZE / size;
  const sampleCount = SAMPLES_PER_AXIS * SAMPLES_PER_AXIS;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      let sumAlpha = 0;

      for (let sampleY = 0; sampleY < SAMPLES_PER_AXIS; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLES_PER_AXIS; sampleX += 1) {
          const x = (pixelX + (sampleX + 0.5) / SAMPLES_PER_AXIS) * scale;
          const y = (pixelY + (sampleY + 0.5) / SAMPLES_PER_AXIS) * scale;
          const color = colorAt(x, y);
          if (color === null) continue;

          sumRed += color[0];
          sumGreen += color[1];
          sumBlue += color[2];
          sumAlpha += 1;
        }
      }

      const offset = (pixelY * size + pixelX) * 4;
      if (sumAlpha === 0) continue;

      data[offset] = Math.round(sumRed / sumAlpha);
      data[offset + 1] = Math.round(sumGreen / sumAlpha);
      data[offset + 2] = Math.round(sumBlue / sumAlpha);
      data[offset + 3] = Math.round((sumAlpha / sampleCount) * 255);
    }
  }

  return data;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBytes = Buffer.from(type, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);

  return Buffer.concat([length, typeBytes, data, checksum]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * stride] = 0;
    rgba.copy(raw, row * stride + 1, row * size * 4, (row + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ring(polygon) {
  const [first, ...rest] = polygon.map(
    ([x, y]) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`,
  );
  return `M${first}L${rest.join('L')}Z`;
}

function partTag(part, fill) {
  // evenodd keeps the hole of ㅇ transparent in the plain logo.
  const d = [part.outer, ...(part.holes ?? [])].map(ring).join('');
  return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
}

function renderLogoSvg() {
  const accent = ACCENT_PARTS.map((part) => partTag(part, ACCENT)).join('');
  const white = WHITE_PARTS.map((part) => partTag(part, WHITE)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Huttak">${accent}${white}</svg>\n`;
}

function renderSvg() {
  const accent = ICON_ACCENT.map((part) => partTag(part, ACCENT)).join('\n  ');
  const white = ICON_WHITE.map((part) => partTag(part, WHITE)).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title">
  <title id="title">Huttak</title>
  <rect width="128" height="128" rx="${BACKGROUND.radius}" fill="#101828"/>
  ${accent}
  ${white}
</svg>
`;
}

function renderMarkModule() {
  const entries = [
    ...ICON_ACCENT.map((part) => [part, ACCENT]),
    ...ICON_WHITE.map((part) => [part, WHITE]),
  ]
    .map(([part, fill]) => {
      const d = [part.outer, ...(part.holes ?? [])].map(ring).join('');
      return `  ['${d}', '${fill}'],`;
    })
    .join('\n');
  return `// Generated by scripts/generate-icons.mjs. Do not edit by hand.
// The Huttak mark as drawn on the rounded plate, the same shapes as scripts/icon.svg.

export const MARK_BACKGROUND = '#101828';

/** [SVG path data, fill]. Paths with a hole use the evenodd rule. */
export const MARK_PATHS: readonly (readonly [string, string])[] = [
${entries}
];
`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function assertPngSize(buffer, expectedSize) {
  const signatureMatches = PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
  if (!signatureMatches) throw new Error(`icon ${expectedSize}px is not a PNG file`);

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`icon ${expectedSize}px has unexpected dimensions ${width}x${height}`);
  }
}

await mkdir(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const path = join(OUTPUT_DIR, `${size}.png`);
  await writeFile(path, encodePng(size, renderRgba(size)));
  assertPngSize(await readFile(path), size);
}

await writeFile(SVG_PATH, renderSvg(), 'utf8');
await writeFile(LOGO_PATH, renderLogoSvg(), 'utf8');
await writeFile(MARK_MODULE_PATH, renderMarkModule(), 'utf8');
