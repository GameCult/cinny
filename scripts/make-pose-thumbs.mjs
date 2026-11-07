// Regenerates preview-demo/poses from the cast-art poses: PNG thumbnails sized for the
// portrait's displayed width x a phone's device pixel ratio (not for the 124px desktop box).
// Dependency-free: decodes 8-bit RGBA PNGs, area-averages in premultiplied alpha, writes a
// 256-colour palette PNG with a tRNS alpha table. Usage: node scripts/make-pose-thumbs.mjs [src]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const WIDTH = 480; // phone portrait: min(50vw, 210px) x DPR 2.5; art is never upscaled
const src = process.argv[2] ?? '/opt/commons/cast-art/poses';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'preview-demo/poses');
const demoMinds = ['eureka', 'void', 'nibu'];

function decode(buf) {
  let off = 8;
  let w, h;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error('need 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (line[x] + p) & 255;
    }
  }
  return { w, h, px };
}

// Separable area average over premultiplied RGBA floats.
function resize({ w, h, px }, nw, nh) {
  const pre = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) pre[i * 4 + c] = px[i * 4 + c] * a;
    pre[i * 4 + 3] = px[i * 4 + 3];
  }
  const pass = (data, sw, sh, dw, dh, horiz) => {
    const out = new Float32Array((horiz ? dw * sh : sw * dh) * 4);
    const n = horiz ? dw : dh;
    const sn = horiz ? sw : sh;
    const scale = sn / n;
    for (let o = 0; o < n; o++) {
      const s0 = o * scale,
        s1 = (o + 1) * scale;
      for (let i = Math.floor(s0); i < Math.min(sn, Math.ceil(s1)); i++) {
        const wt = Math.min(i + 1, s1) - Math.max(i, s0);
        const lines = horiz ? sh : sw;
        for (let l = 0; l < lines; l++) {
          const si = (horiz ? l * sw + i : i * sw + l) * 4;
          const di = (horiz ? l * dw + o : o * dw + l) * 4;
          for (let c = 0; c < 4; c++) out[di + c] += (data[si + c] * wt) / scale;
        }
      }
    }
    return out;
  };
  const mid = pass(pre, w, h, nw, h, true);
  const fin = pass(mid, nw, h, nw, nh, false);
  const out = Buffer.alloc(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) {
    const a = fin[i * 4 + 3];
    out[i * 4 + 3] = Math.round(a);
    for (let c = 0; c < 3; c++)
      out[i * 4 + c] = a > 0 ? Math.min(255, Math.round((fin[i * 4 + c] * 255) / a)) : 0;
  }
  return out;
}

// Median cut to 256 colours over (r,g,b,a); alpha is a quantised channel too.
function quantise(px, n) {
  const key = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]];
  const hist = new Map();
  for (let i = 0; i < n; i++) {
    const q = key(i).map((v) => v & 0xf8);
    const k = (q[0] << 24) | (q[1] << 16) | (q[2] << 8) | q[3];
    const e = hist.get(k) ?? { c: q, n: 0 };
    e.n++;
    hist.set(k, e);
  }
  let boxes = [[...hist.values()]];
  while (boxes.length < 256) {
    let bi = -1,
      best = 0,
      ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 4; c++) {
        const vs = b.map((e) => e.c[c]);
        const r = (Math.max(...vs) - Math.min(...vs)) * Math.sqrt(b.reduce((s, e) => s + e.n, 0));
        if (r > best) {
          best = r;
          bi = i;
          ch = c;
        }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x.c[ch] - y.c[ch]);
    const half = b.reduce((s, e) => s + e.n, 0) / 2;
    let acc = 0,
      cut = 1;
    for (; cut < b.length - 1 && acc + b[cut - 1].n < half; cut++) acc += b[cut - 1].n;
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const pal = boxes.map((b) => {
    const t = b.reduce((s, e) => s + e.n, 0);
    return [0, 1, 2, 3].map((c) => Math.round(b.reduce((s, e) => s + e.c[c] * e.n, 0) / t));
  });
  const idx = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const k = (px[i * 4] << 24) | (px[i * 4 + 1] << 16) | (px[i * 4 + 2] << 8) | px[i * 4 + 3];
    let j = cache.get(k);
    if (j === undefined) {
      let bd = Infinity;
      pal.forEach((p, pi) => {
        const d = [0, 1, 2, 3].reduce((s, c) => s + (p[c] - px[i * 4 + c]) ** 2, 0);
        if (d < bd) {
          bd = d;
          j = pi;
        }
      });
      cache.set(k, j);
    }
    idx[i] = j;
  }
  return { pal, idx };
}

function chunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 8 + data.length);
  return out;
}

function encode(w, h, { pal, idx }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++)
    Buffer.from(idx.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(pal.flatMap((p) => p.slice(0, 3)))),
    chunk('tRNS', Buffer.from(pal.map((p) => p[3]))),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const catalogue = JSON.parse(readFileSync(join(src, 'catalogue.json'), 'utf8'));
let total = 0;
for (const mind of demoMinds) {
  const m = catalogue.minds[mind];
  for (const f of [...Object.values(m.shared), ...Object.values(m.signatures)]) {
    const img = decode(readFileSync(join(src, f)));
    const nw = Math.min(WIDTH, img.w);
    const nh = Math.round((img.h * nw) / img.w);
    const png = encode(nw, nh, quantise(resize(img, nw, nh), nw * nh));
    mkdirSync(dirname(join(outDir, f)), { recursive: true });
    writeFileSync(join(outDir, f), png);
    total += png.length;
    console.log(f, `${nw}x${nh}`, png.length);
  }
}
console.log('total', total);
