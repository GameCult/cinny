import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DingManifest, Motif, dingsEnabled, parseManifest, pickDing } from './dings';

// The staged v3 set (Aqua, AquaSynth PR #22). Nobody has heard it; these tests check the manifest
// against this code, not the sound.
const DINGS = join(__dirname, '../../../../public/dings');
const raw = JSON.parse(readFileSync(join(DINGS, 'manifest.json'), 'utf8'));
const manifest = parseManifest(raw) as DingManifest;
const MOTIFS: Motif[] = ['mention', 'dm', 'message', 'invite'];
const VOICES = ['aqua', 'eureka', 'heimdall', 'kiko', 'libby', 'nibu', 'void', 'weksa'];

// Vorbis-in-Ogg duration: last page's granule position over the sample rate in the id header.
const oggMs = (file: string): number => {
  const b = readFileSync(join(DINGS, file));
  const id = b.indexOf('\x01vorbis', 0, 'latin1');
  const rate = b.readUInt32LE(id + 12);
  const last = b.lastIndexOf('OggS', b.length, 'latin1');
  return (Number(b.readBigUInt64LE(last + 6)) / rate) * 1000;
};

describe('dings switch', () => {
  it('is off unless the config says exactly true', () => {
    expect(dingsEnabled(undefined)).toBe(false);
    expect(dingsEnabled({})).toBe(false);
    expect(dingsEnabled({ enabled: false })).toBe(false);
    expect(dingsEnabled({ enabled: 'true' as unknown as boolean })).toBe(false);
    expect(dingsEnabled({ enabled: true })).toBe(true);
  });

  it('ships off in config.json', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../../../../config.json'), 'utf8'));
    expect(config.dings).toEqual({ enabled: false });
    expect(dingsEnabled(config.dings)).toBe(false);
  });
});

describe('v3 manifest against the parser', () => {
  it('survives parseManifest whole: no path or motif is dropped', () => {
    expect(manifest.neutral).toEqual(raw.neutral);
    expect(Object.keys(manifest.senders).sort()).toEqual(VOICES);
    VOICES.forEach((v) => expect(manifest.senders[v]).toEqual(raw.senders[v]));
    MOTIFS.forEach((m) => expect(manifest.neutral[m]).toBeDefined());
  });

  it('names a file that exists for every clip, and no file the manifest omits', () => {
    const paths = [
      ...Object.values(manifest.neutral),
      ...Object.values(manifest.senders).flatMap((c) => Object.values(c)),
    ];
    expect(paths).toHaveLength(4 + VOICES.length * 4);
    paths.forEach((p) => expect(existsSync(join(DINGS, p as string)), p).toBe(true));
  });

  it('maps a sender localpart to that sender folder, per motif', () => {
    VOICES.forEach((v) =>
      MOTIFS.forEach((m) => expect(pickDing(manifest, v, m)?.path).toBe(`senders/${v}/${m}.ogg`))
    );
  });

  it('an unknown sender and an invite get the neutral clip', () => {
    MOTIFS.forEach((m) => expect(pickDing(manifest, 'someone', m)?.path).toBe(`neutral/${m}.ogg`));
  });

  it('Nibu carries pick 3 (8 kHz 5-bit smoothed sine) for every event: senders/nibu, never the proposals folder', () => {
    MOTIFS.forEach((m) => {
      const path = pickDing(manifest, 'nibu', m)?.path as string;
      expect(path).toBe(`senders/nibu/${m}.ogg`);
      expect(path).not.toContain('proposals');
    });
  });

  it("Nibu's four files are AquaSynth's proposals/nibu3 (sha256 prefix)", () => {
    const want: Record<Motif, string> = {
      mention: '3833f504903f',
      dm: 'ad4839400f2c',
      message: '6ec6fc893b94',
      invite: 'aefb6ff79c42',
    };
    MOTIFS.forEach((m) => {
      const hash = createHash('sha256').update(readFileSync(join(DINGS, `senders/nibu/${m}.ogg`)));
      expect(hash.digest('hex').slice(0, 12)).toBe(want[m]);
    });
  });

  it('keeps the clip lengths the design assumes: message under 400 ms, nothing over 600 ms', () => {
    VOICES.forEach((v) => {
      expect(oggMs(`senders/${v}/message.ogg`)).toBeLessThan(400);
      MOTIFS.forEach((m) => expect(oggMs(`senders/${v}/${m}.ogg`)).toBeLessThan(601));
    });
  });
});
