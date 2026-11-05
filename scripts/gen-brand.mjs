// Draws the Ratatoskr squirrel once, as shapes, and writes the SVG logos plus the
// favicon and app-icon PNGs from the same shapes (no image tools needed).
// Run: node scripts/gen-brand.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#1c1b22';

// Squirrel facing right on a 64x64 grid. Later shapes draw over earlier ones.
const squirrel = [
  { t: 'ellipse', cx: 19, cy: 33, rx: 13, ry: 22, rot: -15, fill: '#d9742b' },
  { t: 'ellipse', cx: 21, cy: 33, rx: 7, ry: 15, rot: -15, fill: '#f0a45d' },
  { t: 'ellipse', cx: 36, cy: 43, rx: 11, ry: 14, rot: 0, fill: '#e0833a' },
  { t: 'ellipse', cx: 40, cy: 46, rx: 6, ry: 9, rot: 0, fill: '#f6dcb8' },
  {
    t: 'poly',
    pts: [
      [35, 19],
      [36, 7],
      [43, 15],
    ],
    fill: '#c9672a',
  },
  {
    t: 'poly',
    pts: [
      [44, 15],
      [50, 7],
      [52, 19],
    ],
    fill: '#c9672a',
  },
  { t: 'circle', cx: 43, cy: 25, r: 10, fill: '#e0833a' },
  { t: 'ellipse', cx: 47, cy: 29, rx: 5, ry: 3.5, rot: 0, fill: '#f6dcb8' },
  { t: 'circle', cx: 46.5, cy: 23.5, r: 1.8, fill: '#1a1a1a' },
  { t: 'circle', cx: 47, cy: 23, r: 0.6, fill: '#ffffff' },
  { t: 'circle', cx: 52, cy: 27.5, r: 1.5, fill: '#1a1a1a' },
  { t: 'ellipse', cx: 33, cy: 56, rx: 5, ry: 2.5, rot: 0, fill: '#c9672a' },
  { t: 'ellipse', cx: 44, cy: 56, rx: 4.5, ry: 2.5, rot: 0, fill: '#c9672a' },
];
const badge = (fill) => [
  { t: 'circle', cx: 52, cy: 52, r: 11, fill: '#ffffff' },
  { t: 'circle', cx: 52, cy: 52, r: 8, fill },
];
const background = [{ t: 'rect', x: 0, y: 0, w: 64, h: 64, fill: BG }];

const f = (n) => +n.toFixed(2);
const svgOf = (shapes) =>
  shapes
    .map((s) => {
      if (s.t === 'circle')
        return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}"/>`;
      if (s.t === 'rect') return `<rect width="${s.w}" height="${s.h}" fill="${s.fill}"/>`;
      if (s.t === 'poly')
        return `<polygon points="${s.pts.map((p) => p.join(',')).join(' ')}" fill="${s.fill}"/>`;
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" transform="rotate(${s.rot} ${s.cx} ${s.cy})" fill="${s.fill}"/>`;
    })
    .join('\n');
const writeSvg = (name, shapes) =>
  writeFileSync(
    join(root, 'public/res/svg', name),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n${svgOf(
      shapes
    )}\n</svg>\n`
  );

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const inside = (s, x, y) => {
  if (s.t === 'rect') return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
  if (s.t === 'circle') return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2;
  if (s.t === 'ellipse') {
    const a = (-s.rot * Math.PI) / 180;
    const dx = x - s.cx;
    const dy = y - s.cy;
    const u = dx * Math.cos(a) - dy * Math.sin(a);
    const v = dx * Math.sin(a) + dy * Math.cos(a);
    return (u / s.rx) ** 2 + (v / s.ry) ** 2 <= 1;
  }
  let c = false;
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    const [xi, yi] = s.pts[i];
    const [xj, yj] = s.pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

// Rasterise with 4x4 supersampling; `scale` shrinks the drawing about the centre.
const png = (shapes, size, scale = 1) => {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;
  const colours = shapes.map((s) => hex(s.fill));
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const gx = ((px + (sx + 0.5) / SS) / size) * 64;
          const gy = ((py + (sy + 0.5) / SS) / size) * 64;
          // the background rect covers the whole canvas and ignores `scale`
          let hit = -1;
          shapes.forEach((s, i) => {
            const x = s.t === 'rect' ? gx : (gx - 32) / scale + 32;
            const y = s.t === 'rect' ? gy : (gy - 32) / scale + 32;
            if (inside(s, x, y)) hit = i;
          });
          if (hit >= 0) {
            [r, g, b] = [r + colours[hit][0], g + colours[hit][1], b + colours[hit][2]];
            a += 1;
          }
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ICO container holding PNG images.
const ico = (images) => {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head[e] = size;
    head[e + 1] = size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
};

writeSvg('ratatoskr.svg', squirrel);
writeSvg('ratatoskr-unread.svg', [...squirrel, ...badge('#989898')]);
writeSvg('ratatoskr-highlight.svg', [...squirrel, ...badge('#45B83B')]);

const icon = [...background, ...squirrel];
const put = (dir, name, size) => {
  mkdirSync(join(root, 'public/res', dir), { recursive: true });
  writeFileSync(join(root, 'public/res', dir, name), png(icon, size, 0.82));
};
[36, 48, 72, 96, 144, 192, 256, 384, 512].forEach((s) =>
  put('android', `android-chrome-${s}x${s}.png`, s)
);
[57, 60, 72, 76, 114, 120, 144, 152, 167, 180].forEach((s) =>
  put('apple', `apple-touch-icon-${s}x${s}.png`, s)
);
writeFileSync(
  join(root, 'public/favicon.ico'),
  ico([16, 32, 48].map((size) => ({ size, data: png(icon, size, 0.9) })))
);
console.log('wrote svg logos, favicon.ico, android and apple icons');
