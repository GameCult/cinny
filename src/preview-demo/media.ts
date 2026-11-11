/* eslint-disable no-bitwise */
// Tiny media for the pretend server's file zone, generated here so the repo holds no binaries.
export type DemoMedia = { type: string; data: Uint8Array };

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le = (n: number, bytes: number): number[] =>
  Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);

/** A 0.6 s mono 8 kHz 8-bit WAV: a sine at `hz` with a soft fade. */
export const wavTone = (hz: number): DemoMedia => {
  const rate = 8000;
  const n = Math.round(rate * 0.6);
  const pcm = Array.from({ length: n }, (_, i) => {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    return Math.round(128 + 90 * fade * Math.sin((2 * Math.PI * hz * i) / rate));
  });
  const tag = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  return {
    type: 'audio/wav',
    data: Uint8Array.from([
      ...tag('RIFF'),
      ...le(36 + n, 4),
      ...tag('WAVEfmt '),
      ...le(16, 4),
      ...le(1, 2),
      ...le(1, 2),
      ...le(rate, 4),
      ...le(rate, 4),
      ...le(1, 2),
      ...le(8, 2),
      ...tag('data'),
      ...le(n, 4),
      ...pcm,
    ]),
  };
};

const crc32 = (bytes: number[]): number => {
  let c = ~0;
  bytes.forEach((b) => {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  });
  return ~c >>> 0;
};

const chunk = (name: string, data: number[]): number[] => {
  const body = [...Array.from(name, (c) => c.charCodeAt(0)), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(body))];
};

/** A 32 x 32 RGB PNG: a diagonal gradient in `rgb`, zlib "stored" blocks, no compression. */
export const pngGradient = (rgb: [number, number, number]): DemoMedia => {
  const size = 32;
  const raw: number[] = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      const f = 0.35 + (0.65 * (x + y)) / (2 * size);
      raw.push(...rgb.map((v) => Math.round(v * f)));
    }
  }
  let a = 1;
  let b = 0;
  raw.forEach((v) => {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  });
  // One stored block holds up to 65535 bytes; 32 * 97 = 3104 fits.
  const zlib = [
    0x78,
    0x01,
    1,
    ...le(raw.length, 2),
    ...le(~raw.length & 0xffff, 2),
    ...raw,
    ...u32(((b << 16) | a) >>> 0),
  ];
  return {
    type: 'image/png',
    data: Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk('IHDR', [...u32(size), ...u32(size), 8, 2, 0, 0, 0]),
      ...chunk('IDAT', zlib),
      ...chunk('IEND', []),
    ]),
  };
};
